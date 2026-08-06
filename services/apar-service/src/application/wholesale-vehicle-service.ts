import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateWholesaleVehicleItemDTO {
  customerId: string;
  vehicleVin: string;
  saleAmount: number;
}

export interface RecordPaymentDTO {
  amount: number;
}

export interface ReleaseTitleExceptionDTO {
  reason: string;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class WholesaleVehicleItemNotFoundError extends Error {
  constructor(id: string) {
    super(`Wholesale vehicle AR item not found: ${id}`);
    this.name = 'WholesaleVehicleItemNotFoundError';
  }
}

export class WholesaleVehicleValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'WholesaleVehicleValidationError';
  }
}

/** AC: unpaid release attempt returns a named refusal — server-enforced,
 * never bypassable from the UI alone. */
export class TitleReleaseRefusedUnpaidError extends Error {
  constructor(itemId: string, outstandingBalance: string) {
    super(`Title release refused for item ${itemId} — item is not paid in full (outstanding balance: ${outstandingBalance}). Use the release-exception path if authorized.`);
    this.name = 'TitleReleaseRefusedUnpaidError';
  }
}

/**
 * CE-09 S048 — Wholesale Vehicle AR & Title Gate. A wholesale vehicle sale
 * receivable with a server-enforced title-release gate: releaseTitle()
 * refuses (TitleReleaseRefusedUnpaidError / TITLE_RELEASE_REFUSED_UNPAID)
 * unless the item is PAID_IN_FULL; releaseTitleWithException() is a
 * distinct, separately-permissioned (enforced at the route layer),
 * mandatory-reason, fully-audited escape hatch that names the authorizing
 * user and is itself queryable via listExceptions().
 */
@injectable()
export class WholesaleVehicleService {
  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  async list(tenantId: string, customerId?: string) {
    return this.prisma.arWholesaleVehicleItem.findMany({ where: { tenantId, ...(customerId ? { customerId } : {}) }, orderBy: { createdAt: 'desc' } });
  }

  async getById(tenantId: string, id: string) {
    const item = await this.prisma.arWholesaleVehicleItem.findFirst({ where: { id, tenantId } });
    if (!item) throw new WholesaleVehicleItemNotFoundError(id);
    return item;
  }

  async create(tenantId: string, dto: CreateWholesaleVehicleItemDTO, actor = 'system') {
    if (!dto.customerId?.trim()) throw new WholesaleVehicleValidationError('CUSTOMER_REQUIRED', 'customerId is required');
    if (!dto.vehicleVin?.trim()) throw new WholesaleVehicleValidationError('VIN_REQUIRED', 'vehicleVin is required');
    if (!(dto.saleAmount > 0)) throw new WholesaleVehicleValidationError('INVALID_SALE_AMOUNT', 'saleAmount must be positive');

    return this.prisma.$transaction(async (tx: any) => {
      const created = await tx.arWholesaleVehicleItem.create({
        data: { tenantId, customerId: dto.customerId, vehicleVin: dto.vehicleVin, saleAmount: dto.saleAmount, status: 'OPEN', createdBy: actor },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArWholesaleVehicleItem', docId: created.id, action: 'CREATED', before: null, after: created, actor, correlationId: null },
      });
      return created;
    });
  }

  /**
   * Records a payment against the item, in-transaction under a row lock so
   * concurrent payments can never race past the paid-in-full threshold.
   * Paid-in-full items become auto-eligible for release (AC) — this method
   * only updates eligibility; the actual release is always a separate,
   * explicit action (releaseTitle / releaseTitleWithException).
   */
  async recordPayment(tenantId: string, id: string, dto: RecordPaymentDTO, actor = 'system') {
    if (!(dto.amount > 0)) throw new WholesaleVehicleValidationError('INVALID_AMOUNT', 'amount must be positive');

    return this.prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, tenant_id, sale_amount, amount_paid, status, version FROM ar_wholesale_vehicle_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        id, tenantId,
      );
      if (!locked || locked.length === 0) throw new WholesaleVehicleItemNotFoundError(id);
      const current = locked[0];
      if (current.status === 'CLOSED') throw new WholesaleVehicleValidationError('ITEM_CLOSED', 'Item is closed and cannot accept further payments');

      const newAmountPaid = Number(current.amount_paid) + dto.amount;
      const saleAmount = Number(current.sale_amount);
      const newStatus = newAmountPaid >= saleAmount ? 'PAID_IN_FULL' : 'OPEN';

      const updated = await tx.arWholesaleVehicleItem.update({
        where: { id }, data: { amountPaid: newAmountPaid, status: newStatus, version: current.version + 1 },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArWholesaleVehicleItem', docId: id, action: 'PAYMENT_RECORDED', before: current, after: updated, actor, correlationId: null },
      });
      return updated;
    });
  }

  /**
   * D-CE09 (S048 AC): server-enforced — refuses unless the item is
   * PAID_IN_FULL. Runs under a row lock so a concurrent payment cannot
   * race the release decision.
   */
  async releaseTitle(tenantId: string, id: string, actor = 'system', correlationId?: string) {
    return this.prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, sale_amount, amount_paid, status, title_released, version FROM ar_wholesale_vehicle_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        id, tenantId,
      );
      if (!locked || locked.length === 0) throw new WholesaleVehicleItemNotFoundError(id);
      const current = locked[0];
      if (current.title_released) throw new WholesaleVehicleValidationError('ALREADY_RELEASED', 'Title has already been released for this item');
      if (current.status !== 'PAID_IN_FULL') {
        const outstanding = (Number(current.sale_amount) - Number(current.amount_paid)).toFixed(2);
        throw new TitleReleaseRefusedUnpaidError(id, outstanding);
      }

      const updated = await tx.arWholesaleVehicleItem.update({
        where: { id }, data: { titleReleased: true, titleReleasedAt: new Date(), titleReleasedBy: actor, version: current.version + 1 },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArWholesaleVehicleItem', docId: id, action: 'TITLE_RELEASED', before: current, after: updated, actor, correlationId: correlationId ?? null },
      });
      return updated;
    });
  }

  /**
   * Distinct, separately-permissioned (enforced at the route layer, see
   * ar.wholesale.title_release_exception), mandatory-reason exception path
   * — creates a fully-queryable/auditable ArTitleReleaseException record
   * naming the authorizing user, alongside the normal audit-outbox entry.
   */
  async releaseTitleWithException(tenantId: string, id: string, dto: ReleaseTitleExceptionDTO, actor: string, correlationId?: string) {
    if (!dto.reason?.trim()) throw new WholesaleVehicleValidationError('REASON_REQUIRED', 'A reason is required to release title via exception');

    return this.prisma.$transaction(async (tx: any) => {
      const locked = await tx.$queryRawUnsafe(
        `SELECT id, sale_amount, amount_paid, status, title_released, version FROM ar_wholesale_vehicle_items WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        id, tenantId,
      );
      if (!locked || locked.length === 0) throw new WholesaleVehicleItemNotFoundError(id);
      const current = locked[0];
      if (current.title_released) throw new WholesaleVehicleValidationError('ALREADY_RELEASED', 'Title has already been released for this item');

      const outstandingBalance = Number(current.sale_amount) - Number(current.amount_paid);

      const updated = await tx.arWholesaleVehicleItem.update({
        where: { id }, data: { titleReleased: true, titleReleasedAt: new Date(), titleReleasedBy: actor, titleReleaseException: true, version: current.version + 1 },
      });
      const exception = await tx.arTitleReleaseException.create({
        data: { tenantId, itemId: id, reason: dto.reason, authorizedBy: actor, outstandingBalance },
      });
      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArWholesaleVehicleItem', docId: id, action: 'TITLE_RELEASED_EXCEPTION', before: current, after: { ...updated, exception }, actor, correlationId: correlationId ?? null },
      });
      return { item: updated, exception };
    });
  }

  async listExceptions(tenantId: string, itemId?: string) {
    return this.prisma.arTitleReleaseException.findMany({ where: { tenantId, ...(itemId ? { itemId } : {}) }, orderBy: { createdAt: 'desc' } });
  }
}

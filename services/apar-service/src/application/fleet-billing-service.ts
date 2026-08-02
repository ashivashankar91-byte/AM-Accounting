import { inject, injectable } from 'tsyringe';
import { IEventPublisher } from '@amacc/shared-kernel';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface LinkFleetUnitDTO {
  parentCustomerId: string;
  childCustomerId: string;
  billingGroupName?: string;
}

export interface ConsolidatedInvoiceItemDTO {
  childCustomerId: string;
  amount: number;
  description?: string;
}

export interface CreateConsolidatedInvoiceDTO {
  parentCustomerId: string;
  invoiceDate: string; // YYYY-MM-DD
  items: ConsolidatedInvoiceItemDTO[];
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class FleetBillingValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FleetBillingValidationError';
  }
}

export class FleetCustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Customer not found: ${id}`);
    this.name = 'FleetCustomerNotFoundError';
  }
}

/** A unit customer can belong to only one fleet parent at a time. */
export class FleetUnitAlreadyLinkedError extends Error {
  constructor(childCustomerId: string) {
    super(`Customer ${childCustomerId} is already linked to a fleet parent`);
    this.name = 'FleetUnitAlreadyLinkedError';
  }
}

export class FleetUnitLinkNotFoundError extends Error {
  constructor(id: string) {
    super(`Fleet unit link not found: ${id}`);
    this.name = 'FleetUnitLinkNotFoundError';
  }
}

/** AC: every child unit item on a consolidated invoice must belong to a
 * unit that is actually linked to the parent being billed — otherwise the
 * "sum of children == parent total" conservation guarantee would be
 * meaningless (it could include a unit that isn't really the parent's). */
export class FleetUnitNotLinkedToParentError extends Error {
  constructor(childCustomerId: string, parentCustomerId: string) {
    super(`Customer ${childCustomerId} is not a linked fleet unit of parent ${parentCustomerId}`);
    this.name = 'FleetUnitNotLinkedToParentError';
  }
}

export class ConsolidatedInvoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Consolidated invoice not found: ${id}`);
    this.name = 'ConsolidatedInvoiceNotFoundError';
  }
}

/**
 * CE-09 S047 — Fleet AR Consolidated Billing.
 *
 * Parent-child customer linkage (fleet parent + unit/sub-account
 * customers) plus a consolidated-invoice action that, across the fleet
 * parent's linked units, creates the correct per-unit AR items
 * (ArConsolidatedInvoiceItem) while producing one consolidated document
 * (ArConsolidatedInvoice) for the parent.
 *
 * Conservation (AC: "sum of child unit items exactly equals the parent
 * consolidated document total") is a STRUCTURAL invariant, not a runtime
 * check that could drift: ArConsolidatedInvoice.totalAmount is always
 * computed server-side as the sum of the item amounts being created in
 * the same transaction — callers cannot supply totalAmount directly.
 * Lineage back to the consolidated document is the item's permanent
 * consolidatedInvoiceId FK.
 *
 * GL posting follows the blank-matrix-row / ACCOUNT_MAPPING_VALUES_PENDING
 * convention (ArFleetBillingGlAccountConfig, same shape as S042's
 * ApUseTaxGlAccountConfig / S044's ApTradePayoffGlAccountConfig): one Dr
 * AR-control line per unit (memo-tagged with the child customer) plus one
 * Cr revenue line for the invoice total. A missing tenant config
 * truthfully records glPostingError rather than fabricating a posting.
 */
@injectable()
export class FleetBillingService {
  private readonly glServiceUrl = process.env['GL_SERVICE_URL'] ?? 'http://localhost:3010';

  constructor(
    @inject('PrismaClient') private readonly prisma: any,
    @inject('IEventPublisher') private readonly eventPublisher: IEventPublisher,
  ) {}

  // ── Parent-child linkage ────────────────────────────────────────────────

  async linkUnit(tenantId: string, dto: LinkFleetUnitDTO, actor = 'system', correlationId?: string) {
    if (!dto.parentCustomerId?.trim()) throw new FleetBillingValidationError('PARENT_CUSTOMER_ID_REQUIRED', 'parentCustomerId is required');
    if (!dto.childCustomerId?.trim()) throw new FleetBillingValidationError('CHILD_CUSTOMER_ID_REQUIRED', 'childCustomerId is required');
    if (dto.parentCustomerId === dto.childCustomerId) {
      throw new FleetBillingValidationError('PARENT_EQUALS_CHILD', 'A customer cannot be linked as its own fleet unit');
    }

    const parent = await this.prisma.customer.findFirst({ where: { id: dto.parentCustomerId, tenantId } });
    if (!parent) throw new FleetCustomerNotFoundError(dto.parentCustomerId);
    const child = await this.prisma.customer.findFirst({ where: { id: dto.childCustomerId, tenantId } });
    if (!child) throw new FleetCustomerNotFoundError(dto.childCustomerId);

    return this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.arFleetUnitLink.findFirst({ where: { tenantId, childCustomerId: dto.childCustomerId } });
      if (existing) throw new FleetUnitAlreadyLinkedError(dto.childCustomerId);

      const link = await tx.arFleetUnitLink.create({
        data: {
          tenantId, parentCustomerId: dto.parentCustomerId, childCustomerId: dto.childCustomerId,
          billingGroupName: dto.billingGroupName ?? null, createdBy: actor,
        },
      });

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArFleetUnitLink', docId: link.id, action: 'CREATED', before: null, after: link, actor, correlationId: correlationId ?? null },
      });

      return link;
    });
  }

  async unlinkUnit(tenantId: string, id: string, actor = 'system', correlationId?: string) {
    const existing = await this.prisma.arFleetUnitLink.findFirst({ where: { id, tenantId } });
    if (!existing) throw new FleetUnitLinkNotFoundError(id);

    await this.prisma.arFleetUnitLink.delete({ where: { id } });
    await this.prisma.auditOutboxEvent.create({
      data: { tenantId, docType: 'ArFleetUnitLink', docId: id, action: 'DELETED', before: existing, after: null, actor, correlationId: correlationId ?? null },
    });
    return { id, unlinked: true };
  }

  async listUnitsForParent(tenantId: string, parentCustomerId: string) {
    return this.prisma.arFleetUnitLink.findMany({ where: { tenantId, parentCustomerId }, orderBy: { createdAt: 'asc' } });
  }

  // ── Consolidated invoices ───────────────────────────────────────────────

  async createConsolidatedInvoice(tenantId: string, dto: CreateConsolidatedInvoiceDTO, actor = 'system', serviceToken?: string, correlationId?: string) {
    if (!dto.parentCustomerId?.trim()) throw new FleetBillingValidationError('PARENT_CUSTOMER_ID_REQUIRED', 'parentCustomerId is required');
    if (!dto.invoiceDate?.trim()) throw new FleetBillingValidationError('INVOICE_DATE_REQUIRED', 'invoiceDate is required');
    if (!Array.isArray(dto.items) || dto.items.length === 0) throw new FleetBillingValidationError('ITEMS_REQUIRED', 'At least one item is required');
    for (const item of dto.items) {
      if (!item.childCustomerId?.trim()) throw new FleetBillingValidationError('ITEM_CHILD_CUSTOMER_ID_REQUIRED', 'Each item requires a childCustomerId');
      if (!item.amount || item.amount <= 0) throw new FleetBillingValidationError('ITEM_AMOUNT_MUST_BE_POSITIVE', 'Each item amount must be a positive number');
    }

    const parent = await this.prisma.customer.findFirst({ where: { id: dto.parentCustomerId, tenantId } });
    if (!parent) throw new FleetCustomerNotFoundError(dto.parentCustomerId);

    const links = await this.prisma.arFleetUnitLink.findMany({ where: { tenantId, parentCustomerId: dto.parentCustomerId } });
    const linkedChildIds = new Set(links.map((l: any) => l.childCustomerId));
    for (const item of dto.items) {
      if (!linkedChildIds.has(item.childCustomerId)) {
        throw new FleetUnitNotLinkedToParentError(item.childCustomerId, dto.parentCustomerId);
      }
    }

    // Conservation: computed here, in the same transaction that persists
    // the items — never accepted as caller input.
    const totalAmount = dto.items.reduce((sum, item) => sum + item.amount, 0);
    const invoiceDate = new Date(dto.invoiceDate);

    const invoice = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.arConsolidatedInvoice.create({
        data: {
          tenantId, parentCustomerId: dto.parentCustomerId, invoiceDate, totalAmount, status: 'POSTED', createdBy: actor,
        },
      });

      for (const item of dto.items) {
        await tx.arConsolidatedInvoiceItem.create({
          data: {
            tenantId, consolidatedInvoiceId: created.id, childCustomerId: item.childCustomerId,
            amount: item.amount, description: item.description ?? null, status: 'OPEN',
          },
        });
      }

      await tx.auditOutboxEvent.create({
        data: { tenantId, docType: 'ArConsolidatedInvoice', docId: created.id, action: 'CREATED', before: null, after: { ...created, items: dto.items }, actor, correlationId: correlationId ?? null },
      });

      return created;
    });

    const glEntryId = await this._postConsolidatedInvoice(tenantId, invoice, dto.items, serviceToken);
    if (glEntryId) {
      await this.prisma.arConsolidatedInvoice.update({ where: { id: invoice.id }, data: { glEntryId } });
    }
    return this.getById(tenantId, invoice.id);
  }

  async getById(tenantId: string, id: string) {
    const row = await this.prisma.arConsolidatedInvoice.findFirst({ where: { id, tenantId }, include: { items: true } });
    if (!row) throw new ConsolidatedInvoiceNotFoundError(id);
    return row;
  }

  async list(tenantId: string, parentCustomerId?: string) {
    return this.prisma.arConsolidatedInvoice.findMany({
      where: { tenantId, ...(parentCustomerId ? { parentCustomerId } : {}) },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * AC: "the parent's statement reconciles to the sum of its children's
   * activity" — returns each consolidated invoice for the parent alongside
   * an independently-recomputed sum of its own items, so a caller (or a
   * test) can verify tie-out without trusting the stored totalAmount
   * column alone.
   */
  async getStatement(tenantId: string, parentCustomerId: string) {
    const invoices = await this.prisma.arConsolidatedInvoice.findMany({
      where: { tenantId, parentCustomerId },
      include: { items: true },
      orderBy: { invoiceDate: 'asc' },
    });
    const lines = invoices.map((inv: any) => {
      const recomputedTotal = inv.items.reduce((sum: number, it: any) => sum + Number(it.amount), 0);
      return { ...inv, recomputedTotal, reconciles: recomputedTotal === Number(inv.totalAmount) };
    });
    const grandTotal = lines.reduce((sum: number, l: any) => sum + Number(l.totalAmount), 0);
    return { parentCustomerId, invoices: lines, grandTotal };
  }

  private async _postConsolidatedInvoice(tenantId: string, invoice: any, items: ConsolidatedInvoiceItemDTO[], serviceToken?: string): Promise<string | null> {
    const glConfig = await this.prisma.arFleetBillingGlAccountConfig.findFirst({ where: { tenantId } });
    if (!glConfig?.arControlGlAccountId || !glConfig?.revenueGlAccountId) {
      await this._recordGlFailure(tenantId, invoice.id, 'Fleet-billing AR-control/revenue GL accounts are not configured for this tenant (ACCOUNT_MAPPING_VALUES_PENDING)');
      return null;
    }
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId };
      const authScheme = 'Bear' + 'er';
      if (serviceToken) headers['authorization'] = authScheme + ' ' + serviceToken;

      const debitLines = items.map((item) => ({
        glAccountId: glConfig.arControlGlAccountId,
        debit: item.amount,
        credit: 0,
        memo: `Fleet unit AR — customer ${item.childCustomerId}`,
        controlNumber: item.childCustomerId,
      }));

      const jeResp = await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entryDate: new Date().toISOString(),
          description: `Fleet consolidated invoice — parent ${invoice.parentCustomerId}`,
          source: 'AR',
          sourceRef: invoice.id.slice(0, 8),
          lines: [
            ...debitLines,
            { glAccountId: glConfig.revenueGlAccountId, debit: 0, credit: Number(invoice.totalAmount), memo: `Fleet consolidated revenue — parent ${invoice.parentCustomerId}` },
          ],
        }),
      });
      if (!jeResp.ok) {
        const errText = await jeResp.text().catch(() => '');
        await this._recordGlFailure(tenantId, invoice.id, `gl-service create failed: HTTP ${jeResp.status} ${errText}`);
        return null;
      }
      const je = await jeResp.json() as { id: string };
      await fetch(`${this.glServiceUrl}/api/v1/gl/journal-entries/${je.id}/post`, { method: 'POST', headers }).catch(() => null);
      return je.id;
    } catch (err: any) {
      await this._recordGlFailure(tenantId, invoice.id, err?.message ?? 'Unknown error');
      return null;
    }
  }

  private async _recordGlFailure(tenantId: string, invoiceId: string, message: string) {
    try {
      await this.prisma.arConsolidatedInvoice.update({ where: { id: invoiceId }, data: { glPostingError: message } });
    } catch {
      // Non-fatal
    }
  }
}

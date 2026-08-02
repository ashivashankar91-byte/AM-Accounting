import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { validateTenders, TenderInput } from '../domain/cash-receipt';
import { canIssueReceipt, canVoidDirect, DrawerStatus, Violation } from '../domain/cash-drawer';
import { toCents, centsToDollars } from '../domain/money';
import { ReceiptSequenceService } from './receipt-sequence-service';
import { CashReceiptPostingPort } from './cash-receipt-posting-consumer';

export class ReceiptInputError extends Error {
  readonly status = 400;
  readonly code = 'RECEIPT_INPUT_ERROR';
}

export class ReceiptValidationError extends Error {
  readonly status = 422;
  readonly code = 'RECEIPT_VALIDATION_ERROR';
  constructor(readonly violations: Violation[]) {
    super('Receipt rejected: ' + violations.map((v) => v.diagnostic).join('; '));
    this.name = 'ReceiptValidationError';
  }
}

export class DrawerNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'DRAWER_NOT_FOUND';
}

export class DrawerNotOpenError extends Error {
  readonly status = 409;
  readonly code = 'DRAWER_NOT_OPEN';
  constructor(message = 'Receipts can only be issued against an OPEN drawer') {
    super(message);
    this.name = 'DrawerNotOpenError';
  }
}

export class ReceiptNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'RECEIPT_NOT_FOUND';
}

export class VoidReasonRequiredError extends Error {
  readonly status = 422;
  readonly code = 'VOID_REASON_REQUIRED';
  constructor(message = 'A void reason is required') {
    super(message);
    this.name = 'VoidReasonRequiredError';
  }
}

export class VoidNotEligibleError extends Error {
  readonly status = 409;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'VoidNotEligibleError';
  }
}

export interface CreateReceiptDTO {
  tenantId: string;
  entityId: string;
  drawerId: string;
  sourceDocType: string;
  sourceDocId: string;
  sourceDisplayNumber?: string | null;
  payerReference?: string | null;
  amountDue?: number | string | null;
  totalAmount: number | string;
  currency?: string | null;
  tenders: TenderInput[];
  idempotencyKey: string;
  actor: string;
}

export interface SearchReceiptsFilters {
  receiptNumber?: string;
  sourceDocId?: string;
  cashierId?: string;
  drawerId?: string;
  status?: string;
  storeId?: string;
  limit?: number;
  offset?: number;
}

const includeTenders = { tenders: true } as const;

@injectable()
export class ReceiptService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('ReceiptSequenceService') private readonly sequence: ReceiptSequenceService,
    @inject('CashReceiptPostingPort') private readonly posting: CashReceiptPostingPort,
  ) {}

  /**
   * BR: atomic across receipt header + tender lines + append-only drawer
   * movements + audit + outbox (one interactive transaction). BR: opening
   * float is locked (immutable) the moment the first receipt is issued.
   * Idempotent on (tenantId, idempotencyKey) — a duplicate key, including a
   * concurrent duplicate that loses the unique-constraint race, returns the
   * original result rather than a second receipt.
   */
  async createReceipt(dto: CreateReceiptDTO) {
    if (!dto.idempotencyKey) throw new ReceiptInputError('idempotencyKey is required');
    if (!dto.sourceDocType) throw new ReceiptInputError('sourceDocType is required');
    if (!dto.sourceDocId) throw new ReceiptInputError('sourceDocId is required');

    const prior = await this.prisma.cashReceipt.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
      include: includeTenders,
    });
    if (prior) return { ...prior, idempotent: true };

    const drawer = await this.prisma.cashDrawer.findFirst({ where: { id: dto.drawerId, tenantId: dto.tenantId } });
    if (!drawer) throw new DrawerNotFoundError();
    if (!canIssueReceipt(drawer.status as DrawerStatus)) throw new DrawerNotOpenError();

    const totalCents = toCents(dto.totalAmount);
    const tenderResult = validateTenders(totalCents, dto.tenders);
    if (!tenderResult.pass) throw new ReceiptValidationError(tenderResult.violations);

    const alloc = await this.sequence.allocate({
      tenantId: dto.tenantId,
      storeId: drawer.storeId,
      storeCode: drawer.storeCode,
      businessDate: drawer.businessDate.toISOString().slice(0, 10),
    });

    const receiptId = crypto.randomUUID();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await setTenantContextOnConnection(tx, dto.tenantId);

        if (!drawer.floatLocked) {
          await tx.cashDrawer.update({ where: { id: drawer.id }, data: { floatLocked: true, version: { increment: 1 } } });
        }

        await tx.cashReceipt.create({
          data: {
            id: receiptId,
            tenantId: dto.tenantId,
            entityId: dto.entityId,
            storeId: drawer.storeId,
            drawerId: drawer.id,
            receiptNumber: alloc.receiptNumber,
            status: 'ISSUED',
            sourceDocType: dto.sourceDocType,
            sourceDocId: dto.sourceDocId,
            sourceDisplayNumber: dto.sourceDisplayNumber ?? null,
            payerReference: dto.payerReference ?? null,
            amountDue: dto.amountDue != null ? centsToDollars(toCents(dto.amountDue)) : null,
            totalAmount: centsToDollars(totalCents),
            currency: dto.currency ?? drawer.currency,
            cashierId: drawer.cashierId,
            idempotencyKey: dto.idempotencyKey,
          },
        });

        for (const t of tenderResult.tenders) {
          await tx.cashReceiptTender.create({
            data: {
              id: crypto.randomUUID(),
              tenantId: dto.tenantId,
              receiptId,
              tenderType: t.tenderType,
              amount: centsToDollars(t.amountCents),
              cashTendered: t.cashTenderedCents != null ? centsToDollars(t.cashTenderedCents) : null,
              changeGiven: t.changeGivenCents != null ? centsToDollars(t.changeGivenCents) : null,
              checkNumber: t.checkNumber,
              checkPayer: t.checkPayer,
            },
          });
          await tx.cashDrawerMovement.create({
            data: {
              id: crypto.randomUUID(),
              tenantId: dto.tenantId,
              drawerId: drawer.id,
              movementType: t.tenderType === 'CASH' ? 'CASH_RECEIPT' : 'CHECK_RECEIPT',
              amount: centsToDollars(t.amountCents),
              tenderType: t.tenderType,
              receiptId,
              checkNumber: t.checkNumber,
            },
          });
        }

        const payload = {
          receiptId, receiptNumber: alloc.receiptNumber, drawerId: drawer.id,
          totalAmount: centsToDollars(totalCents), sourceDocType: dto.sourceDocType, sourceDocId: dto.sourceDocId,
        };
        await tx.auditOutboxEvent.create({
          data: {
            id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_RECEIPT', docId: receiptId,
            action: 'CASH_RECEIPT_ISSUED', before: null as any, after: payload as any, actor: dto.actor,
          },
        });
        await tx.cashOutboxEvent.create({
          data: { id: crypto.randomUUID(), tenantId: dto.tenantId, eventType: 'cash.receipt.issued', aggregateId: receiptId, payload: payload as any },
        });

        return tx.cashReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: includeTenders });
      });

      try {
        await this.events.publish({
          type: 'cash.receipt.issued', tenantId: dto.tenantId, payload: { receiptId },
          occurredAt: new Date().toISOString(), correlationId: receiptId,
        } as any);
      } catch {
        /* outbox row already durable */
      }

      // CE-07/S052 real accounting consumer (D-S023-04) — best-effort,
      // never blocks or fails the receipt itself.
      await this.posting.submit({
        tenantId: dto.tenantId, entityId: dto.entityId, receiptId, receiptNumber: alloc.receiptNumber,
        totalAmount: centsToDollars(totalCents), currency: dto.currency ?? drawer.currency,
        sourceDocType: dto.sourceDocType, sourceDocId: dto.sourceDocId,
        businessDate: drawer.businessDate.toISOString().slice(0, 10),
      });

      return { ...created, idempotent: false };
    } catch (err: any) {
      if (err?.code === 'P2002' && String(err?.meta?.target ?? '').includes('idempotency')) {
        const winner = await this.prisma.cashReceipt.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
          include: includeTenders,
        });
        if (winner) return { ...winner, idempotent: true };
      }
      throw err;
    }
  }

  async searchReceipts(tenantId: string, filters: SearchReceiptsFilters) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: any = { tenantId };
    if (filters.receiptNumber) where.receiptNumber = { contains: filters.receiptNumber, mode: 'insensitive' };
    if (filters.sourceDocId) where.sourceDocId = filters.sourceDocId;
    if (filters.cashierId) where.cashierId = filters.cashierId;
    if (filters.drawerId) where.drawerId = filters.drawerId;
    if (filters.status) where.status = filters.status;
    if (filters.storeId) where.storeId = filters.storeId;

    const [items, total] = await Promise.all([
      this.prisma.cashReceipt.findMany({ where, include: includeTenders, orderBy: { issuedAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.cashReceipt.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async getReceiptById(tenantId: string, receiptId: string) {
    const receipt = await this.prisma.cashReceipt.findFirst({ where: { id: receiptId, tenantId }, include: includeTenders });
    if (!receipt) throw new ReceiptNotFoundError();
    return receipt;
  }

  /** Every call is audited as a (re)print — the first successful render of a
   * newly-issued receipt and any later reprint look identical from the
   * caller's side, and both are worth a durable trail. */
  async getPrintable(tenantId: string, receiptId: string, actor: string) {
    const receipt = await this.prisma.cashReceipt.findFirst({
      where: { id: receiptId, tenantId },
      include: { tenders: true, drawer: true },
    });
    if (!receipt) throw new ReceiptNotFoundError();

    await this.prisma.auditOutboxEvent.create({
      data: {
        id: crypto.randomUUID(), tenantId, docType: 'CASH_RECEIPT', docId: receiptId,
        action: 'CASH_RECEIPT_REPRINTED', before: null as any,
        after: { receiptId, receiptNumber: receipt.receiptNumber } as any, actor,
      },
    });

    return receipt;
  }

  /**
   * BR: preserves the original receipt row; writes compensating movements
   * (never mutates the original CashDrawerMovement rows — append-only).
   * Rejected once the drawer has left OPEN (blind-count submitted or
   * reconciled) — that rejection is itself audited (VOID_REJECTED) before
   * throwing, since it's a real, permission-gated write-path attempt even
   * though no business state changes. Idempotent: voiding an
   * already-VOIDED receipt returns the same result without writing again.
   */
  async voidReceipt(dto: { tenantId: string; receiptId: string; reason: string; actor: string }) {
    if (!dto.reason || !dto.reason.trim()) throw new VoidReasonRequiredError();

    const receipt = await this.prisma.cashReceipt.findFirst({
      where: { id: dto.receiptId, tenantId: dto.tenantId },
      include: includeTenders,
    });
    if (!receipt) throw new ReceiptNotFoundError();
    if (receipt.status === 'VOIDED') return { ...receipt, idempotent: true };

    const drawer = await this.prisma.cashDrawer.findFirst({ where: { id: receipt.drawerId, tenantId: dto.tenantId } });
    if (!drawer || !canVoidDirect(drawer.status as DrawerStatus)) {
      await this.prisma.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_RECEIPT', docId: dto.receiptId,
          action: 'CASH_RECEIPT_VOID_REJECTED', before: null as any,
          after: { reason: dto.reason, drawerStatus: drawer?.status ?? 'UNKNOWN' } as any, actor: dto.actor,
        },
      });
      throw new VoidNotEligibleError(
        'VOID_REJECTED_DRAWER_STATE',
        'This receipt cannot be voided — its drawer is no longer OPEN (blind count already submitted or the drawer is reconciled)',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, dto.tenantId);

      await tx.cashReceipt.update({
        where: { id: receipt.id },
        data: { status: 'VOIDED', voidedAt: new Date(), voidReason: dto.reason, voidedBy: dto.actor, version: { increment: 1 } },
      });

      for (const t of receipt.tenders) {
        const amountCents = toCents(t.amount.toString());
        await tx.cashDrawerMovement.create({
          data: {
            id: crypto.randomUUID(),
            tenantId: dto.tenantId,
            drawerId: drawer.id,
            movementType: t.tenderType === 'CASH' ? 'CASH_VOID_REVERSAL' : 'CHECK_VOID_REVERSAL',
            amount: centsToDollars(-amountCents),
            tenderType: t.tenderType,
            receiptId: receipt.id,
            checkNumber: t.checkNumber,
          },
        });
      }

      const payload = { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, reason: dto.reason };
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_RECEIPT', docId: receipt.id,
          action: 'CASH_RECEIPT_VOID_REQUESTED', before: { status: 'ISSUED' } as any, after: payload as any, actor: dto.actor,
        },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_RECEIPT', docId: receipt.id,
          action: 'CASH_RECEIPT_VOIDED', before: { status: 'ISSUED' } as any, after: { status: 'VOIDED', ...payload } as any, actor: dto.actor,
        },
      });
      await tx.cashOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId: dto.tenantId, eventType: 'cash.receipt.voided', aggregateId: receipt.id, payload: payload as any },
      });

      return tx.cashReceipt.findUniqueOrThrow({ where: { id: receipt.id }, include: includeTenders });
    });

    try {
      await this.events.publish({
        type: 'cash.receipt.voided', tenantId: dto.tenantId, payload: { receiptId: receipt.id },
        occurredAt: new Date().toISOString(), correlationId: receipt.id,
      } as any);
    } catch {
      /* outbox row already durable */
    }

    return { ...updated, idempotent: false };
  }
}

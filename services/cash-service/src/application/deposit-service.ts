import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { canAddReceiptToDeposit, canPostDeposit, canVoidDeposit, assertDepositConserves } from '../domain/deposit';
import { toCents, centsToDollars } from '../domain/money';
import { buildMatrixRowEnvelope } from '../domain/posting-envelope';

export class DepositInputError extends Error {
  readonly status = 400;
  readonly code = 'DEPOSIT_INPUT_ERROR';
}

export class DepositNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'DEPOSIT_NOT_FOUND';
}

export class ReceiptNotEligibleError extends Error {
  readonly status = 409;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ReceiptNotEligibleError';
  }
}

export class DepositNotPostableError extends Error {
  readonly status = 409;
  readonly code = 'DEPOSIT_NOT_POSTABLE';
  constructor(message = 'Deposit is not in a postable state (must be OPEN)') {
    super(message);
    this.name = 'DepositNotPostableError';
  }
}

export class DepositNotVoidableError extends Error {
  readonly status = 409;
  readonly code = 'DEPOSIT_NOT_VOIDABLE';
  constructor(message = 'Deposit can only be voided while OPEN') {
    super(message);
    this.name = 'DepositNotVoidableError';
  }
}

export interface CreateDepositBatchDTO {
  tenantId: string;
  entityId: string;
  storeId: string;
  bankAccountCode: string;
  businessDate: string; // YYYY-MM-DD
  receiptIds: string[];
  idempotencyKey: string;
  actor: string;
}

const includeLines = { lines: true } as const;

/**
 * S053 — Deposit batch creation, deposit-slip data, and posting
 * (clearing->cash) for undeposited cash receipts. Every write path here is
 * idempotent (createDepositBatch on idempotencyKey; postDeposit is a no-op
 * on an already-POSTED deposit) and every receipt->deposit link is unique
 * tenant-wide (cash_deposit_line's DB constraint) — a receipt cannot be
 * deposited twice even under a concurrent race (P2002 caught below).
 */
@injectable()
export class DepositService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
  ) {}

  async createDepositBatch(dto: CreateDepositBatchDTO) {
    if (!dto.idempotencyKey) throw new DepositInputError('idempotencyKey is required');
    if (!dto.bankAccountCode) throw new DepositInputError('bankAccountCode is required');
    if (!dto.receiptIds || dto.receiptIds.length === 0) throw new DepositInputError('receiptIds must be non-empty');

    const prior = await this.prisma.cashDeposit.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
      include: includeLines,
    });
    if (prior) return { ...prior, idempotent: true };

    const receipts = await this.prisma.cashReceipt.findMany({
      where: { tenantId: dto.tenantId, id: { in: dto.receiptIds } },
    });
    if (receipts.length !== dto.receiptIds.length) {
      throw new DepositInputError('One or more receiptIds were not found for this tenant');
    }
    for (const r of receipts) {
      if (!canAddReceiptToDeposit(r.status)) {
        throw new ReceiptNotEligibleError('RECEIPT_NOT_DEPOSITABLE', `Receipt ${r.id} is not ISSUED (status=${r.status})`);
      }
    }
    // BR: a receipt already on another deposit (any status) can never be
    // added again — checked here for a fast, clear error; the DB unique
    // constraint is the authoritative guard against a concurrent race.
    const existingLines = await this.prisma.cashDepositLine.findMany({
      where: { tenantId: dto.tenantId, receiptId: { in: dto.receiptIds } },
    });
    if (existingLines.length > 0) {
      throw new ReceiptNotEligibleError(
        'RECEIPT_ALREADY_DEPOSITED',
        `Receipt(s) already deposited: ${existingLines.map((l) => l.receiptId).join(', ')}`,
      );
    }

    const totalCents = receipts.reduce((acc, r) => acc + toCents(r.totalAmount.toString()), 0);
    const depositId = crypto.randomUUID();

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await setTenantContextOnConnection(tx, dto.tenantId);

        await tx.cashDeposit.create({
          data: {
            id: depositId,
            tenantId: dto.tenantId,
            entityId: dto.entityId,
            storeId: dto.storeId,
            bankAccountCode: dto.bankAccountCode,
            businessDate: new Date(dto.businessDate),
            status: 'OPEN',
            totalAmount: centsToDollars(totalCents),
            idempotencyKey: dto.idempotencyKey,
            preparedBy: dto.actor,
          },
        });

        for (const r of receipts) {
          const tenders = await tx.cashReceiptTender.findMany({ where: { tenantId: dto.tenantId, receiptId: r.id } });
          // A receipt may carry both CASH and CHECK tenders; deposit lines
          // are per-receipt for simplicity of the deposit-slip breakdown,
          // tender type recorded as the dominant tender (first present) —
          // full tender-level breakdown is available via the receipt itself.
          const tenderType = tenders[0]?.tenderType ?? 'CASH';
          await tx.cashDepositLine.create({
            data: {
              id: crypto.randomUUID(),
              tenantId: dto.tenantId,
              depositId,
              receiptId: r.id,
              tenderType,
              amount: r.totalAmount,
            },
          });
        }

        await tx.auditOutboxEvent.create({
          data: {
            id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'CASH_DEPOSIT', docId: depositId,
            action: 'CASH_DEPOSIT_BATCH_CREATED', before: null as any,
            after: { depositId, receiptIds: dto.receiptIds, totalAmount: centsToDollars(totalCents) } as any,
            actor: dto.actor,
          },
        });

        return tx.cashDeposit.findUniqueOrThrow({ where: { id: depositId }, include: includeLines });
      });

      return { ...created, idempotent: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.cashDeposit.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
          include: includeLines,
        });
        if (winner) return { ...winner, idempotent: true };
        throw new ReceiptNotEligibleError('RECEIPT_ALREADY_DEPOSITED', 'A receipt in this batch was concurrently deposited elsewhere');
      }
      throw err;
    }
  }

  async getDepositSlip(tenantId: string, depositId: string) {
    const deposit = await this.getById(tenantId, depositId);
    const byTender = new Map<string, number>();
    for (const l of deposit.lines) {
      byTender.set(l.tenderType, (byTender.get(l.tenderType) ?? 0) + toCents(l.amount.toString()));
    }
    return {
      depositId: deposit.id,
      bankAccountCode: deposit.bankAccountCode,
      businessDate: deposit.businessDate,
      status: deposit.status,
      totalAmount: deposit.totalAmount,
      lineCount: deposit.lines.length,
      tenderBreakdown: Array.from(byTender.entries()).map(([tenderType, cents]) => ({
        tenderType, amount: centsToDollars(cents),
      })),
      lines: deposit.lines,
    };
  }

  async getById(tenantId: string, depositId: string) {
    const deposit = await this.prisma.cashDeposit.findFirst({ where: { id: depositId, tenantId }, include: includeLines });
    if (!deposit) throw new DepositNotFoundError();
    return deposit;
  }

  async search(tenantId: string, filters: { status?: string; storeId?: string; bankAccountCode?: string; limit?: number; offset?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: any = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.storeId) where.storeId = filters.storeId;
    if (filters.bankAccountCode) where.bankAccountCode = filters.bankAccountCode;
    const [items, total] = await Promise.all([
      this.prisma.cashDeposit.findMany({ where, include: includeLines, orderBy: { preparedAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.cashDeposit.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  /**
   * BR: idempotent — posting an already-POSTED deposit returns the same
   * result without emitting a second event (a deposit cannot be posted
   * twice). Conservation is asserted before posting: line sum must equal
   * the stated total to the cent. Emits `cash.deposit.posted` as a
   * canonical matrix-row envelope (S023 row: bank cash account DR /
   * undeposited-funds clearing account CR — both ACCOUNT_MAPPING_VALUES_PENDING,
   * resolved by the posting engine, never by this service).
   */
  async postDeposit(tenantId: string, depositId: string, actor: string) {
    const deposit = await this.getById(tenantId, depositId);
    if (deposit.status === 'POSTED') return { ...deposit, idempotent: true };
    if (!canPostDeposit(deposit.status as any)) throw new DepositNotPostableError();

    const totalCents = toCents(deposit.totalAmount.toString());
    assertDepositConserves(deposit.lines.map((l) => ({ amount: l.amount.toString() })), totalCents);

    const eventId = crypto.randomUUID();
    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.cashDeposit.update({
        where: { id: depositId },
        data: { status: 'POSTED', postedBy: actor, postedAt: new Date(), version: { increment: 1 } },
      });

      const envelope = buildMatrixRowEnvelope({
        eventId,
        tenantId,
        legalEntityId: deposit.entityId,
        eventType: 'cash.deposit.posted',
        sourceEntityType: 'CASH_DEPOSIT',
        sourceEntityId: depositId,
        businessDate: deposit.businessDate.toISOString().slice(0, 10),
        correlationId: depositId,
        idempotencyIdentity: `cash.deposit.posted:${tenantId}:${depositId}`,
        accountingAmounts: [{ amount: deposit.totalAmount.toString(), currency: deposit.currency, kind: 'GROSS' }],
        accountingReferences: [{ referenceNumber: depositId, applyNumber: deposit.bankAccountCode }],
        storeId: deposit.storeId,
      });

      await tx.cashOutboxEvent.create({
        data: { id: eventId, tenantId, eventType: 'cash.deposit.posted', aggregateId: depositId, payload: envelope as any },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId, docType: 'CASH_DEPOSIT', docId: depositId,
          action: 'CASH_DEPOSIT_POSTED', before: { status: 'OPEN' } as any,
          after: { status: 'POSTED', totalAmount: deposit.totalAmount } as any, actor,
        },
      });

      return tx.cashDeposit.findUniqueOrThrow({ where: { id: depositId }, include: includeLines });
    });

    try {
      await this.events.publish({ type: 'cash.deposit.posted', tenantId, payload: { depositId }, occurredAt: new Date().toISOString(), correlationId: depositId } as any);
    } catch {
      /* outbox row already durable */
    }

    return { ...updated, idempotent: false };
  }

  async voidDeposit(tenantId: string, depositId: string, reason: string, actor: string) {
    const deposit = await this.getById(tenantId, depositId);
    if (deposit.status === 'VOID') return { ...deposit, idempotent: true };
    if (!canVoidDeposit(deposit.status as any)) throw new DepositNotVoidableError();

    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.cashDeposit.update({
        where: { id: depositId },
        data: { status: 'VOID', voidedBy: actor, voidedAt: new Date(), voidReason: reason, version: { increment: 1 } },
      });
      // Remove the deposit-line links so their receipts become eligible for
      // a future deposit batch again — the receipts themselves are untouched.
      await tx.cashDepositLine.deleteMany({ where: { tenantId, depositId } });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId, docType: 'CASH_DEPOSIT', docId: depositId,
          action: 'CASH_DEPOSIT_VOIDED', before: { status: 'OPEN' } as any, after: { status: 'VOID', reason } as any, actor,
        },
      });
      return tx.cashDeposit.findUniqueOrThrow({ where: { id: depositId }, include: includeLines });
    });

    return { ...updated, idempotent: false };
  }
}

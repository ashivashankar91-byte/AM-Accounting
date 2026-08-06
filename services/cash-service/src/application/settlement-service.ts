import { inject, injectable } from 'tsyringe';
import crypto from 'crypto';
import { IEventPublisher, setTenantContextOnConnection } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { toCents, centsToDollars } from '../domain/money';
import { assertGrossFeeNetProves, isValidDispositionAction } from '../domain/settlement';
import { buildMatrixRowEnvelope } from '../domain/posting-envelope';
import { SettlementAdapter, UnconfiguredSettlementAdapter } from '../infrastructure/settlement-adapter';

export class SettlementInputError extends Error {
  readonly status = 400;
  readonly code = 'SETTLEMENT_INPUT_ERROR';
}

export class SettlementBatchNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'SETTLEMENT_BATCH_NOT_FOUND';
}

export class SettlementNotPostableError extends Error {
  readonly status = 409;
  readonly code = 'SETTLEMENT_NOT_POSTABLE';
}

export class ChargebackNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'CHARGEBACK_NOT_FOUND';
}

export class ChargebackAlreadyDispositionedError extends Error {
  readonly status = 409;
  readonly code = 'CHARGEBACK_ALREADY_DISPOSITIONED';
}

export interface ImportSettlementBatchDTO {
  tenantId: string;
  entityId: string;
  bankAccountCode: string;
  processorName: string;
  batchReference: string;
  settlementDate: string;
  grossAmount: number | string;
  feeAmount: number | string;
  netAmount: number | string;
  idempotencyKey: string;
  actor: string;
}

const includeAll = { lines: true, chargebacks: true } as const;

/**
 * S055 — merchant card-settlement batch ingestion (manual import always
 * available; see infrastructure/settlement-adapter.ts for the truthful
 * no-processor-wired state), matching to card-tender receipts/deposits,
 * fee recognition (its own, never-netted journal line), unmatched-lines
 * worklist, and governed chargeback disposition.
 */
@injectable()
export class SettlementService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IEventPublisher') private readonly events: IEventPublisher,
    @inject('SettlementAdapter') private readonly adapter: SettlementAdapter = new UnconfiguredSettlementAdapter(),
  ) {}

  getAdapterStatus() {
    return { state: this.adapter.getState() };
  }

  /**
   * AC: gross - fees = net provable per batch — asserted here AND enforced
   * by the DB CHECK constraint (settlement_batch_gross_fee_net_check), so
   * even a direct-SQL bypass of this service cannot create a batch that
   * doesn't tie out.
   */
  async importBatch(dto: ImportSettlementBatchDTO) {
    if (!dto.idempotencyKey) throw new SettlementInputError('idempotencyKey is required');
    if (!dto.processorName || !dto.batchReference) throw new SettlementInputError('processorName and batchReference are required');

    const prior = await this.prisma.settlementBatch.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
      include: includeAll,
    });
    if (prior) return { ...prior, idempotent: true };

    const grossCents = toCents(dto.grossAmount);
    const feeCents = toCents(dto.feeAmount);
    const netCents = toCents(dto.netAmount);
    assertGrossFeeNetProves(grossCents, feeCents, netCents);

    const batchId = crypto.randomUUID();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await setTenantContextOnConnection(tx, dto.tenantId);
        await tx.settlementBatch.create({
          data: {
            id: batchId, tenantId: dto.tenantId, entityId: dto.entityId, bankAccountCode: dto.bankAccountCode,
            processorName: dto.processorName, batchReference: dto.batchReference, settlementDate: new Date(dto.settlementDate),
            grossAmount: centsToDollars(grossCents), feeAmount: centsToDollars(feeCents), netAmount: centsToDollars(netCents),
            status: 'IMPORTED', idempotencyKey: dto.idempotencyKey, importedBy: dto.actor,
          },
        });
        await tx.auditOutboxEvent.create({
          data: {
            id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'SETTLEMENT_BATCH', docId: batchId,
            action: 'SETTLEMENT_BATCH_IMPORTED', before: null as any,
            after: { batchId, gross: dto.grossAmount, fee: dto.feeAmount, net: dto.netAmount } as any, actor: dto.actor,
          },
        });
        return tx.settlementBatch.findUniqueOrThrow({ where: { id: batchId }, include: includeAll });
      });
      return { ...created, idempotent: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const winner = await this.prisma.settlementBatch.findUnique({
          where: { tenantId_idempotencyKey: { tenantId: dto.tenantId, idempotencyKey: dto.idempotencyKey } },
          include: includeAll,
        });
        if (winner) return { ...winner, idempotent: true };
      }
      throw err;
    }
  }

  /** Matches a card-tender receipt/deposit into the batch. Not a worklist item once matched. */
  async matchLine(dto: { tenantId: string; batchId: string; receiptId?: string; depositId?: string; amount: number | string; actor: string }) {
    const batch = await this.getById(dto.tenantId, dto.batchId);
    const line = await this.prisma.settlementBatchLine.create({
      data: {
        id: crypto.randomUUID(), tenantId: dto.tenantId, batchId: batch.id,
        receiptId: dto.receiptId ?? null, depositId: dto.depositId ?? null, amount: dto.amount, matchedBy: dto.actor,
      },
    });
    return line;
  }

  /** AC: unmatched settlement lines land in an explicit worklist, never auto-absorbed. */
  async addToWorklist(dto: { tenantId: string; batchId?: string; bankAccountCode: string; amount: number | string; cardLast4?: string | null; transactionRef?: string | null }) {
    return this.prisma.settlementWorklistItem.create({
      data: {
        id: crypto.randomUUID(), tenantId: dto.tenantId, batchId: dto.batchId ?? null, bankAccountCode: dto.bankAccountCode,
        amount: dto.amount, cardLast4: dto.cardLast4 ?? null, transactionRef: dto.transactionRef ?? null, status: 'OPEN',
      },
    });
  }

  async resolveWorklistItem(tenantId: string, itemId: string, actor: string) {
    return this.prisma.settlementWorklistItem.update({
      where: { id: itemId },
      data: { status: 'RESOLVED', resolvedBy: actor, resolvedAt: new Date() },
    });
  }

  async listWorklist(tenantId: string, filters: { status?: string } = {}) {
    return this.prisma.settlementWorklistItem.findMany({ where: { tenantId, ...(filters.status ? { status: filters.status } : {}) } });
  }

  /**
   * Posts the batch: emits `cash.settlement.fee.recognized` — the fee is
   * ALWAYS its own journal line (gross deposit vs net settlement
   * difference), never silently netted into the deposit. Idempotent.
   */
  async postBatch(tenantId: string, batchId: string, actor: string) {
    const batch = await this.getById(tenantId, batchId);
    if (batch.status === 'POSTED') return { ...batch, idempotent: true };
    if (batch.status !== 'IMPORTED' && batch.status !== 'MATCHED') throw new SettlementNotPostableError();

    const eventId = crypto.randomUUID();
    const updated = await this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.settlementBatch.update({ where: { id: batchId }, data: { status: 'POSTED', postedBy: actor, postedAt: new Date(), version: { increment: 1 } } });

      const envelope = buildMatrixRowEnvelope({
        eventId, tenantId, legalEntityId: batch.entityId, eventType: 'cash.settlement.fee.recognized',
        sourceEntityType: 'SETTLEMENT_BATCH', sourceEntityId: batchId,
        businessDate: batch.settlementDate.toISOString().slice(0, 10), correlationId: batchId,
        idempotencyIdentity: `cash.settlement.fee.recognized:${tenantId}:${batchId}`,
        accountingAmounts: [
          { amount: batch.grossAmount.toString(), currency: batch.currency, kind: 'GROSS' },
          { amount: batch.feeAmount.toString(), currency: batch.currency, kind: 'FEE' },
          { amount: batch.netAmount.toString(), currency: batch.currency, kind: 'NET' },
        ],
        accountingReferences: [{ referenceNumber: batchId, applyNumber: batch.batchReference }],
      });
      await tx.cashOutboxEvent.create({ data: { id: eventId, tenantId, eventType: 'cash.settlement.fee.recognized', aggregateId: batchId, payload: envelope as any } });
      await tx.auditOutboxEvent.create({
        data: { id: crypto.randomUUID(), tenantId, docType: 'SETTLEMENT_BATCH', docId: batchId, action: 'SETTLEMENT_BATCH_POSTED', before: { status: batch.status } as any, after: { status: 'POSTED' } as any, actor },
      });
      return tx.settlementBatch.findUniqueOrThrow({ where: { id: batchId }, include: includeAll });
    });

    try {
      await this.events.publish({ type: 'cash.settlement.fee.recognized', tenantId, payload: { batchId }, occurredAt: new Date().toISOString(), correlationId: batchId } as any);
    } catch {
      /* outbox row already durable */
    }
    return { ...updated, idempotent: false };
  }

  async getById(tenantId: string, batchId: string) {
    const batch = await this.prisma.settlementBatch.findFirst({ where: { id: batchId, tenantId }, include: includeAll });
    if (!batch) throw new SettlementBatchNotFoundError();
    return batch;
  }

  async search(tenantId: string, filters: { status?: string; limit?: number; offset?: number }) {
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: any = { tenantId, ...(filters.status ? { status: filters.status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.settlementBatch.findMany({ where, include: includeAll, orderBy: { importedAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.settlementBatch.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  /** Chargeback intake — governed adjustment created once per disposition action. */
  async intakeChargeback(dto: { tenantId: string; entityId: string; batchId?: string; customerId?: string | null; amount: number | string; reasonCode?: string | null; actor: string }) {
    return this.prisma.settlementChargeback.create({
      data: {
        id: crypto.randomUUID(), tenantId: dto.tenantId, entityId: dto.entityId, batchId: dto.batchId ?? null,
        customerId: dto.customerId ?? null, amount: dto.amount, reasonCode: dto.reasonCode ?? null, status: 'INTAKE',
      },
    });
  }

  /**
   * AC: each chargeback creates its dispositioned item EXACTLY once — the
   * unique FK on settlement_adjustment(chargeback_id) is the DB-level
   * guarantee; this method is also idempotent app-side (re-disposition of
   * an already-dispositioned chargeback is rejected, not silently re-run).
   * PUTR: when disposition = CUSTOMER_RESPONSIBILITY, this record IS the
   * customer-responsibility item today; `arItemReference` stays null until
   * apar-service exposes a reachable AR-item-creation endpoint to link to.
   */
  async dispositionChargeback(dto: { tenantId: string; chargebackId: string; dispositionAction: string; actor: string }) {
    if (!isValidDispositionAction(dto.dispositionAction)) {
      throw new SettlementInputError('dispositionAction must be CUSTOMER_RESPONSIBILITY or MERCHANT_ABSORBED');
    }
    const chargeback = await this.prisma.settlementChargeback.findFirst({ where: { id: dto.chargebackId, tenantId: dto.tenantId } });
    if (!chargeback) throw new ChargebackNotFoundError();
    if (chargeback.status === 'DISPOSITIONED') throw new ChargebackAlreadyDispositionedError();

    return this.prisma.$transaction(async (tx) => {
      await setTenantContextOnConnection(tx, dto.tenantId);
      await tx.settlementChargeback.update({
        where: { id: chargeback.id },
        data: { status: 'DISPOSITIONED', dispositionAction: dto.dispositionAction, dispositionedBy: dto.actor, dispositionedAt: new Date() },
      });
      const adjustment = await tx.settlementAdjustment.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, chargebackId: chargeback.id, entityId: chargeback.entityId,
          amount: chargeback.amount, dispositionAction: dto.dispositionAction, arItemReference: null, createdBy: dto.actor,
        },
      });
      await tx.auditOutboxEvent.create({
        data: {
          id: crypto.randomUUID(), tenantId: dto.tenantId, docType: 'SETTLEMENT_CHARGEBACK', docId: chargeback.id,
          action: 'CHARGEBACK_DISPOSITIONED', before: { status: 'INTAKE' } as any,
          after: { dispositionAction: dto.dispositionAction, adjustmentId: adjustment.id } as any, actor: dto.actor,
        },
      });
      return adjustment;
    });
  }
}

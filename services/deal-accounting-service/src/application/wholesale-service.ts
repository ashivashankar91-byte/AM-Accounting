// S090 — Wholesale Disposition & Arbitration.
//
// Posting-group design note (same "mechanical clearing residual" technique
// D-CE12-02's trade-in treatment uses, applied here because coa-service's
// DSL only supports FIXED basis-point allocations per group — a gain/loss
// "plug" whose size varies per deal cannot be expressed as a static bp
// split): three UNCONDITIONAL posting groups, each independently balanced
// against a shared "Wholesale Disposition Clearing" pending account —
// wholesaleAr (DR AR / CR clearing), unitRelief (DR clearing / CR vehicle
// inventory clearing), auctionFees (DR fee expense / CR clearing). The
// clearing account's net balance across all three groups mechanically IS
// the gain or loss (CR wholesaleAmount + DR unitReliefAmount + CR
// auctionFeesAmount nets to wholesaleAmount + auctionFeesAmount -
// unitReliefAmount) — no GAIN/LOSS rule branching needed in the DSL at
// all. dispositionOutcome/gainLossAmount are still computed and stored on
// WholesaleDisposition as descriptive classification (domain/
// conservation.ts's determineWholesaleOutcome), independent of how the
// journal itself is structured.
//
// Title gate: this service refuses to post the wholesale AR segment unless
// titleStatus is explicitly 'RELEASED' — never silently skipped. The real
// CE-09 S048 "title-gated" receivable-item linkage is PENDING_UPSTREAM_
// TECHNICAL_RECONCILIATION (see final delivery summary).

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { toCents, centsToDecimalString } from '../domain/money';
import { determineWholesaleOutcome, applyArbitrationPriceAdjustmentCents } from '../domain/conservation';
import { buildEnvelope } from '../domain/event-envelope';
import { IPostingEngineClient } from '../infrastructure/posting-engine-client';
import { IPostingRecoveryClient } from '../infrastructure/posting-recovery-client';
import { IJournalReversalClient } from '../infrastructure/journal-reversal-client';
import { classifyCoaFailureReason } from '../infrastructure/posting-failure-taxonomy';
import { writePutrOutboxEvent, PUTR_EVENT_TYPES } from '../infrastructure/putr-outbox';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { TitleNotReleasedError, OpenItemNotFoundError, ReasonRequiredError } from './errors';

export const WHOLESALE_DISPOSITION_EVENT = 'deal.wholesale-disposition.v1';
export const ARBITRATION_PRICE_ADJUSTMENT_EVENT = 'deal.arbitration-price-adjustment.v1';
export const ARBITRATION_CONDITION_COST_EVENT = 'deal.arbitration-unit-return-condition-cost.v1';

export interface DisposeWholesaleInput {
  tenantId: string;
  legalEntityId: string;
  storeId: string;
  unitRef: string;
  titleStatus: string;
  wholesaleAmount: string;
  unitReliefAmount: string;
  auctionFeesAmount: string;
  idempotencyKey: string;
  actor: string;
  dealNumber?: string | null;
}

@injectable()
export class WholesaleService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IPostingEngineClient') private readonly postingEngine: IPostingEngineClient,
    @inject('IPostingRecoveryClient') private readonly postingRecovery: IPostingRecoveryClient,
    @inject('IJournalReversalClient') private readonly reversalClient: IJournalReversalClient,
  ) {}

  async dispose(input: DisposeWholesaleInput) {
    const existing = await this.prisma.wholesaleDisposition.findUnique({ where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;

    // Title gate — refuse before any coa-service call.
    if (input.titleStatus !== 'RELEASED') throw new TitleNotReleasedError(input.titleStatus);

    const wholesaleCents = toCents(input.wholesaleAmount);
    const unitReliefCents = toCents(input.unitReliefAmount);
    const { outcome, amountCents } = determineWholesaleOutcome(wholesaleCents, unitReliefCents);

    const eventId = `wholesale:${input.unitRef}:${input.idempotencyKey}`;
    const envelope = buildEnvelope({
      eventId, tenantId: input.tenantId, legalEntityId: input.legalEntityId, eventType: WHOLESALE_DISPOSITION_EVENT, occurredAt: new Date().toISOString(),
      sourceEntityType: 'UNIT', sourceEntityId: input.unitRef, correlationId: `wholesale:${input.unitRef}`,
      businessDate: new Date().toISOString().slice(0, 10),
      payload: { unitRef: input.unitRef, dealNumber: input.dealNumber ?? null, wholesaleAmount: input.wholesaleAmount, unitReliefAmount: input.unitReliefAmount, auctionFeesAmount: input.auctionFeesAmount },
    });
    const result = await this.postingEngine.submitEvent(envelope);
    if (result.status === 'REJECTED' || result.status === 'FAILED') {
      try {
        await this.postingRecovery.fileDeadLetter(envelope, {
          failureCategory: classifyCoaFailureReason(result.failureReason), failureCode: `WHOLESALE_DISPOSITION_${result.status}`,
          failureStage: 'MAPPING', failureMessage: result.failureReason ?? 'unknown', occurredAt: new Date().toISOString(),
        }, { legalEntityId: input.legalEntityId, storeId: input.storeId, sourceTransactionId: input.dealNumber ?? input.unitRef });
      } catch { /* best-effort */ }
    }

    const postingRecordId = randomUUID();
    const disposition = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, input.tenantId);
      // dealId is nullable in principle for a bypass-desking wholesale, but
      // this schema requires a Deal row (FK) — for a direct-from-inventory
      // wholesale not run through S084, an operational Deal row of type
      // WHOLESALE should be created upstream before calling this endpoint;
      // documented in http/routes.ts.
      const deal = input.dealNumber
        ? await tx.deal.findUnique({ where: { tenantId_dealNumber: { tenantId: input.tenantId, dealNumber: input.dealNumber } } })
        : null;
      if (input.dealNumber && !deal) throw new OpenItemNotFoundError('DEAL', input.dealNumber);

      await tx.dealPostingRecord.create({
        data: {
          id: postingRecordId, tenantId: input.tenantId, dealId: deal?.id ?? (await this.ensureShellDeal(tx, input)).id, segmentType: 'WHOLESALE_DISPOSITION',
          eventId, eventType: WHOLESALE_DISPOSITION_EVENT, correlationId: `wholesale:${input.unitRef}`,
          coaStatus: result.status, coaExecutionId: result.executionId ?? null, journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          failureReason: result.failureReason ?? null, amountsJson: { wholesaleCents, unitReliefCents, outcome, amountCents }, createdBy: input.actor,
        },
      });

      const d = await tx.wholesaleDisposition.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, dealId: deal?.id ?? (await this.ensureShellDeal(tx, input)).id, unitRef: input.unitRef, titleStatus: input.titleStatus,
          wholesaleAmount: input.wholesaleAmount, unitReliefAmount: input.unitReliefAmount, auctionFeesAmount: input.auctionFeesAmount,
          dispositionOutcome: outcome === 'NONE' ? 'GAIN' : outcome, gainLossAmount: centsToDecimalString(amountCents),
          status: 'POSTED', postingRecordId, idempotencyKey: input.idempotencyKey, createdBy: input.actor,
        },
      });

      if (result.status === 'POSTED') {
        await writePutrOutboxEvent(tx, input.tenantId, PUTR_EVENT_TYPES.WHOLESALE_UNIT_RELIEF, input.unitRef, {
          unitRef: input.unitRef, dealNumber: input.dealNumber ?? null, unitReliefAmount: input.unitReliefAmount, legalEntityId: input.legalEntityId, storeId: input.storeId,
        }, `wholesale:${input.unitRef}`);
      }

      await appendAuditReference(tx, { tenantId: input.tenantId, docType: 'WHOLESALE_DISPOSITION', docId: d.id, action: 'POSTED', after: { unitRef: input.unitRef, outcome, amountCents, coaStatus: result.status }, actor: input.actor });
      return d;
    });

    return disposition;
  }

  /** Direct-from-inventory wholesale (no S084 desk deal) — files a minimal operational Deal shell so FK/lineage stays uniform. */
  private async ensureShellDeal(tx: any, input: DisposeWholesaleInput) {
    const dealNumber = input.dealNumber ?? `WS-${input.unitRef}`;
    return tx.deal.upsert({
      where: { tenantId_dealNumber: { tenantId: input.tenantId, dealNumber } },
      update: {},
      create: {
        id: randomUUID(), tenantId: input.tenantId, dealNumber, dealType: 'WHOLESALE', vin: input.unitRef, stockNumber: input.unitRef,
        legalEntityId: input.legalEntityId, storeId: input.storeId, status: 'POSTED', currentRecapVersion: 0, finalizedByActor: input.actor,
      },
    });
  }

  async priceAdjustment(tenantId: string, dispositionId: string, adjustmentAmount: string, reason: string, actor: string, idempotencyKey: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 500) throw new ReasonRequiredError('post an arbitration price adjustment');

    const existing = await this.prisma.arbitrationCase.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
    if (existing) return existing;

    const disposition = await this.prisma.wholesaleDisposition.findFirst({ where: { id: dispositionId, tenantId } });
    if (!disposition) throw new OpenItemNotFoundError('WHOLESALE_DISPOSITION', dispositionId);
    const dealForDisposition = await this.prisma.deal.findUnique({ where: { id: disposition.dealId } });

    const adjustmentCents = toCents(adjustmentAmount); // signed
    const direction = adjustmentCents >= 0 ? 'INCREASE' : 'DECREASE';
    const newArCents = applyArbitrationPriceAdjustmentCents(toCents(disposition.wholesaleAmount.toString()), adjustmentCents);

    const eventId = `arbitration-price:${dispositionId}:${idempotencyKey}`;
    const envelope = buildEnvelope({
      eventId, tenantId, legalEntityId: dealForDisposition!.legalEntityId, eventType: ARBITRATION_PRICE_ADJUSTMENT_EVENT, occurredAt: new Date().toISOString(),
      sourceEntityType: 'UNIT', sourceEntityId: disposition.unitRef, correlationId: `arbitration:${dispositionId}`,
      businessDate: new Date().toISOString().slice(0, 10),
      payload: { unitRef: disposition.unitRef, adjustmentDirection: direction, adjustmentAmount: centsToDecimalString(Math.abs(adjustmentCents)) },
    });
    const result = await this.postingEngine.submitEvent(envelope);
    if (result.status === 'REJECTED' || result.status === 'FAILED') {
      try {
        await this.postingRecovery.fileDeadLetter(envelope, {
          failureCategory: classifyCoaFailureReason(result.failureReason), failureCode: `ARBITRATION_PRICE_${result.status}`,
          failureStage: 'MAPPING', failureMessage: result.failureReason ?? 'unknown', occurredAt: new Date().toISOString(),
        }, {});
      } catch { /* best-effort */ }
    }

    const postingRecordId = randomUUID();
    const arbitration = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.dealPostingRecord.create({
        data: { id: postingRecordId, tenantId, dealId: disposition.dealId, segmentType: 'ARBITRATION', eventId, eventType: ARBITRATION_PRICE_ADJUSTMENT_EVENT,
          correlationId: `arbitration:${dispositionId}`, coaStatus: result.status, journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          failureReason: result.failureReason ?? null, amountsJson: { adjustmentCents, newArCents }, createdBy: actor },
      });
      if (result.status === 'POSTED') {
        await tx.wholesaleDisposition.update({ where: { id: dispositionId }, data: { status: 'ARBITRATED_ADJUSTED', wholesaleAmount: centsToDecimalString(newArCents) } });
      }
      const a = await tx.arbitrationCase.create({
        data: { id: randomUUID(), tenantId, dispositionId, arbitrationType: 'PRICE_ADJUSTMENT', adjustmentAmount: centsToDecimalString(adjustmentCents), reason: trimmed, postingRecordId, idempotencyKey, createdBy: actor },
      });
      await appendAuditReference(tx, { tenantId, docType: 'ARBITRATION_CASE', docId: a.id, action: 'PRICE_ADJUSTED', after: { adjustmentCents, newArCents, coaStatus: result.status }, actor });
      return a;
    });
    return arbitration;
  }

  /** Gap-closure — GET list endpoint for wholesale dispositions (previously
   * only create + get-by-id existed). Real persisted DB data, paginated. */
  async listDispositions(tenantId: string, filter: { status?: string; unitRef?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const where: any = { tenantId };
    if (filter.status) where.status = filter.status;
    if (filter.unitRef) where.unitRef = filter.unitRef;
    const [items, total] = await Promise.all([
      this.prisma.wholesaleDisposition.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.wholesaleDisposition.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async unitReturn(tenantId: string, dispositionId: string, conditionCostAmount: string, reason: string, actor: string, idempotencyKey: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 500) throw new ReasonRequiredError('post an arbitration unit return');

    const existing = await this.prisma.arbitrationCase.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
    if (existing) return existing;

    const disposition = await this.prisma.wholesaleDisposition.findFirst({ where: { id: dispositionId, tenantId } });
    if (!disposition) throw new OpenItemNotFoundError('WHOLESALE_DISPOSITION', dispositionId);
    const dealForDisposition = await this.prisma.deal.findUnique({ where: { id: disposition.dealId } });

    // Full reversal of the original disposition journal (S218-lineaged).
    let reversalJournalNumber: string | null = null;
    if (disposition.postingRecordId) {
      const record = await this.prisma.dealPostingRecord.findFirst({ where: { id: disposition.postingRecordId, tenantId } });
      if (record?.journalEntryId && !record.reversedAt) {
        const reversal = await this.reversalClient.reverse(tenantId, record.journalEntryId, `S090 arbitration unit return: ${trimmed}`);
        await this.prisma.dealPostingRecord.update({ where: { id: record.id }, data: { reversalJournalEntryId: reversal.reversalId, reversalJournalNumber: reversal.reversalNumber, reversedAt: new Date() } });
        reversalJournalNumber = reversal.reversalNumber;
      }
    }

    // Condition-cost lines added on top of the return.
    const eventId = `arbitration-return:${dispositionId}:${idempotencyKey}`;
    const envelope = buildEnvelope({
      eventId, tenantId, legalEntityId: dealForDisposition!.legalEntityId, eventType: ARBITRATION_CONDITION_COST_EVENT, occurredAt: new Date().toISOString(),
      sourceEntityType: 'UNIT', sourceEntityId: disposition.unitRef, correlationId: `arbitration:${dispositionId}`,
      businessDate: new Date().toISOString().slice(0, 10),
      payload: { unitRef: disposition.unitRef, conditionCostAmount },
    });
    const result = await this.postingEngine.submitEvent(envelope);
    if (result.status === 'REJECTED' || result.status === 'FAILED') {
      try {
        await this.postingRecovery.fileDeadLetter(envelope, {
          failureCategory: classifyCoaFailureReason(result.failureReason), failureCode: `ARBITRATION_RETURN_${result.status}`,
          failureStage: 'MAPPING', failureMessage: result.failureReason ?? 'unknown', occurredAt: new Date().toISOString(),
        }, {});
      } catch { /* best-effort */ }
    }

    const postingRecordId = randomUUID();
    const arbitration = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.dealPostingRecord.create({
        data: { id: postingRecordId, tenantId, dealId: disposition.dealId, segmentType: 'ARBITRATION', eventId, eventType: ARBITRATION_CONDITION_COST_EVENT,
          correlationId: `arbitration:${dispositionId}`, coaStatus: result.status, journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null,
          failureReason: result.failureReason ?? null, amountsJson: { conditionCostAmount, reversalJournalNumber }, createdBy: actor },
      });
      await tx.wholesaleDisposition.update({ where: { id: dispositionId }, data: { status: 'ARBITRATED_RETURNED' } });
      const a = await tx.arbitrationCase.create({
        data: { id: randomUUID(), tenantId, dispositionId, arbitrationType: 'UNIT_RETURN', conditionCostAmount, reason: trimmed, postingRecordId, idempotencyKey, createdBy: actor },
      });
      await appendAuditReference(tx, { tenantId, docType: 'ARBITRATION_CASE', docId: a.id, action: 'UNIT_RETURNED', after: { conditionCostAmount, reversalJournalNumber, coaStatus: result.status }, actor });
      return a;
    });
    return arbitration;
  }
}

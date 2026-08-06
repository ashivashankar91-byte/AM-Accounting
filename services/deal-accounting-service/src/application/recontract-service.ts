// S087 — Recontract Delta Posting. D-CE12-01 mandatory safe interim,
// implemented literally: compute the structure hash of recap v(from) vs
// v(to) — same hash ⇒ DELTA (post only per-role dollar differences via
// `deal.recontract-delta.v1`); different hash ⇒ REVERSE_REPOST (S218
// reverse every v(from) segment, then post a fresh full segment set for
// v(to) via the SAME DealPostingOrchestrator finalize/release uses). Both
// paths are S218-lineaged: DELTA rows carry their own DealPostingRecord
// (segmentType RECONTRACT_DELTA); REVERSE_REPOST reuses the original
// records' reversalJournalEntryId/reversedAt fields (same convention
// UnwindService uses) plus fresh CORE/PRODUCT records for v(to) — the full
// lineage chain is queryable via DealRecontract (this row) joined to
// DealPostingRecord filtered by dealId+recapVersion.

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { DealRecapPayload } from '../domain/recap';
import { validateRecapStructural } from '../domain/recap-validation';
import { computeStructureHash, determineRecontractMode } from '../domain/structure-hash';
import { computeRoleDeltas } from '../domain/recontract-delta';
import { segmentsForRecap } from '../domain/segments';
import { buildEnvelope } from '../domain/event-envelope';
import { centsToDecimalString } from '../domain/money';
import { IPostingEngineClient } from '../infrastructure/posting-engine-client';
import { IPostingRecoveryClient } from '../infrastructure/posting-recovery-client';
import { IJournalReversalClient } from '../infrastructure/journal-reversal-client';
import { ITaxResultClient } from '../infrastructure/tax-result-client';
import { classifyCoaFailureReason } from '../infrastructure/posting-failure-taxonomy';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { DealPostingOrchestrator } from './deal-posting-orchestrator';
import { DealNotFoundError, RecapNotFoundError, IdempotentReplayConflictError } from './errors';

export interface RecontractInput {
  tenantId: string;
  dealNumber: string;
  newRecap: DealRecapPayload; // recapVersion must be currentRecapVersion + 1
  actor: string;
}

@injectable()
export class RecontractService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IPostingEngineClient') private readonly postingEngine: IPostingEngineClient,
    @inject('IPostingRecoveryClient') private readonly postingRecovery: IPostingRecoveryClient,
    @inject('IJournalReversalClient') private readonly reversalClient: IJournalReversalClient,
    @inject('ITaxResultClient') private readonly taxResults: ITaxResultClient,
    @inject(DealPostingOrchestrator) private readonly orchestrator: DealPostingOrchestrator,
  ) {}

  async recontract(input: RecontractInput) {
    validateRecapStructural(input.newRecap);

    const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId: input.tenantId, dealNumber: input.dealNumber } } });
    if (!deal) throw new DealNotFoundError(input.dealNumber);

    const fromVersion = deal.currentRecapVersion;
    const toVersion = input.newRecap.recapVersion;
    if (toVersion !== fromVersion + 1) {
      throw new IdempotentReplayConflictError(`Deal "${input.dealNumber}" is at recap version ${fromVersion} — recontract must supply recapVersion ${fromVersion + 1}, got ${toVersion}.`);
    }

    const fromRecap = await this.prisma.dealRecap.findUnique({ where: { tenantId_dealId_recapVersion: { tenantId: input.tenantId, dealId: deal.id, recapVersion: fromVersion } } });
    if (!fromRecap) throw new RecapNotFoundError(input.dealNumber, fromVersion);

    const idempotencyKey = `${input.tenantId}:${input.dealNumber}:recontract:v${fromVersion}->v${toVersion}`;
    const existing = await this.prisma.dealRecontract.findUnique({ where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey } } });
    if (existing) return existing;

    const fromPayload = fromRecap.payload as unknown as DealRecapPayload;
    const toPayload = input.newRecap;

    let toTaxAmountCents: number | null = null;
    if (toPayload.taxResultId) {
      const { toCents } = await import('../domain/money');
      const result = await this.taxResults.fetchUsableResult(input.tenantId, toPayload.taxResultId);
      toTaxAmountCents = toCents(result.totalTax);
    }
    const fromTaxAmountCents = fromRecap.taxAmount != null ? Math.round(Number(fromRecap.taxAmount) * 100) : null;

    const structureHashFrom = computeStructureHash(fromPayload);
    const structureHashTo = computeStructureHash(toPayload);
    const mode = determineRecontractMode(fromPayload, toPayload);

    // File the new immutable recap version (regardless of mode) — the
    // deal's recap history must reflect what desking actually re-finalized.
    await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, input.tenantId);
      await tx.dealRecap.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, dealId: deal.id, recapVersion: toVersion,
          dealType: toPayload.dealType, payload: toPayload as any, structureHash: structureHashTo,
          taxResultId: toPayload.taxResultId ?? null, taxAmount: toTaxAmountCents != null ? (toTaxAmountCents / 100).toFixed(2) : null,
          hasTradeIn: toPayload.hasTradeIn, tradeAllowanceAmount: toPayload.tradeAllowanceAmount ?? null, tradeAcvAmount: toPayload.tradeAcvAmount ?? null,
          commissionBasisSnapshot: (toPayload.commissionBasisSnapshot ?? null) as any, rebateReceivableAmount: toPayload.rebateReceivableAmount ?? null,
          createdBy: input.actor,
        },
      });
      await tx.deal.update({ where: { id: deal.id }, data: { currentRecapVersion: toVersion } });
    });

    let deltaPostingRecordId: string | null = null;
    let reversalPostingRecordId: string | null = null;
    let repostPostingRecordId: string | null = null;

    if (mode === 'DELTA') {
      const deltas = computeRoleDeltas(fromPayload, toPayload, fromTaxAmountCents, toTaxAmountCents);
      for (const delta of deltas) {
        const eventId = `${input.dealNumber}:v${fromVersion}->v${toVersion}:delta:${delta.role}`;
        const envelope = buildEnvelope({
          eventId, tenantId: input.tenantId, legalEntityId: deal.legalEntityId, eventType: 'deal.recontract-delta.v1', occurredAt: new Date().toISOString(),
          sourceEntityType: 'DEAL', sourceEntityId: input.dealNumber,
          correlationId: `recontract:${input.dealNumber}:v${fromVersion}->v${toVersion}`, businessDate: toPayload.businessDate,
          payload: { dealNumber: input.dealNumber, role: delta.role, deltaDirection: delta.direction, deltaAmount: centsToDecimalString(delta.magnitudeCents), fromRecapVersion: fromVersion, toRecapVersion: toVersion },
        });
        const result = await this.postingEngine.submitEvent(envelope);
        if (result.status === 'REJECTED' || result.status === 'FAILED') {
          try {
            await this.postingRecovery.fileDeadLetter(envelope, {
              failureCategory: classifyCoaFailureReason(result.failureReason), failureCode: `RECONTRACT_DELTA_${result.status}`,
              failureStage: 'MAPPING', failureMessage: result.failureReason ?? 'unknown', occurredAt: new Date().toISOString(),
            }, { legalEntityId: toPayload.legalEntityId, storeId: toPayload.storeId, sourceTransactionId: input.dealNumber });
          } catch { /* best-effort */ }
        }
        const recordId = randomUUID();
        await this.prisma.dealPostingRecord.create({
          data: {
            id: recordId, tenantId: input.tenantId, dealId: deal.id, recapVersion: toVersion, segmentType: 'RECONTRACT_DELTA',
            eventId, eventType: 'deal.recontract-delta.v1', correlationId: `recontract:${input.dealNumber}:v${fromVersion}->v${toVersion}`,
            coaStatus: result.status, coaExecutionId: result.executionId ?? null, rulePackVersionId: result.rulePackVersionId ?? null, ruleId: result.ruleId ?? null,
            journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null,
            amountsJson: { role: delta.role, direction: delta.direction, magnitudeCents: delta.magnitudeCents },
            createdBy: input.actor,
          },
        });
        deltaPostingRecordId ??= recordId;
      }
    } else {
      // REVERSE_REPOST — reverse every posted fromVersion segment, then post a fresh v(to) segment set.
      const fromRecords = await this.prisma.dealPostingRecord.findMany({ where: { tenantId: input.tenantId, dealId: deal.id, recapVersion: fromVersion, coaStatus: 'POSTED', reversedAt: null } });
      for (const record of fromRecords) {
        if (!record.journalEntryId) continue;
        const reversal = await this.reversalClient.reverse(input.tenantId, record.journalEntryId, `S087 recontract structure change v${fromVersion}->v${toVersion}`);
        await this.prisma.dealPostingRecord.update({ where: { id: record.id }, data: { reversalJournalEntryId: reversal.reversalId, reversalJournalNumber: reversal.reversalNumber, reversedAt: new Date() } });
        reversalPostingRecordId ??= record.id;
      }

      const segments = segmentsForRecap(toPayload, toTaxAmountCents);
      const repost = await this.orchestrator.postSegments({
        tenantId: input.tenantId, dealId: deal.id, dealNumber: input.dealNumber, recapVersion: toVersion,
        legalEntityId: toPayload.legalEntityId, storeId: toPayload.storeId, businessDate: toPayload.businessDate,
        correlationId: `recontract-repost:${input.dealNumber}:v${toVersion}`, segments, actor: input.actor,
      });
      repostPostingRecordId = repost.outcomes[0]?.postingRecordId ?? null;
    }

    const recontract = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, input.tenantId);
      const r = await tx.dealRecontract.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, dealId: deal.id,
          fromRecapVersion: fromVersion, toRecapVersion: toVersion, mode,
          structureHashFrom, structureHashTo,
          deltaPostingRecordId, reversalPostingRecordId, repostPostingRecordId,
          idempotencyKey, createdBy: input.actor,
        },
      });
      await appendAuditReference(tx, {
        tenantId: input.tenantId, docType: 'DEAL', docId: deal.id, action: 'RECONTRACTED',
        after: { dealNumber: input.dealNumber, fromVersion, toVersion, mode }, actor: input.actor,
      });
      return r;
    });

    return recontract;
  }
}

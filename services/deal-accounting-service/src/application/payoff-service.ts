// S089 — Trade Payoff Issuance & Variance. Consumes the PAYOFF DealOpenItem
// this service created at S084 finalize time. Actual payment RAILS are a
// CE-09 (S044 fast lane) concept — PENDING_UPSTREAM_TECHNICAL_
// RECONCILIATION, see the final delivery summary for the exact expected
// contract. This service's own side: post the "payment issued" leg through
// the rule pack and relieve the local item exactly once (idempotent — a
// second issuance attempt against an already-relieved item is refused).

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { toCents, centsToDecimalString } from '../domain/money';
import { determinePayoffVarianceDisposition, computePayoffVarianceCents } from '../domain/conservation';
import { buildEnvelope } from '../domain/event-envelope';
import { IPostingEngineClient } from '../infrastructure/posting-engine-client';
import { IPostingRecoveryClient } from '../infrastructure/posting-recovery-client';
import { classifyCoaFailureReason } from '../infrastructure/posting-failure-taxonomy';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { DealNotFoundError, OpenItemNotFoundError, AlreadyRelievedError, ReasonRequiredError } from './errors';

export const PAYOFF_ISSUANCE_EVENT = 'deal.payoff-issuance.v1';
export const PAYOFF_VARIANCE_EVENT = 'deal.payoff-variance.v1';

export interface IssuePayoffInput {
  tenantId: string;
  dealNumber: string;
  actualAmount: string;
  idempotencyKey: string;
  actor: string;
}

@injectable()
export class PayoffService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IPostingEngineClient') private readonly postingEngine: IPostingEngineClient,
    @inject('IPostingRecoveryClient') private readonly postingRecovery: IPostingRecoveryClient,
  ) {}

  async issuePayoff(input: IssuePayoffInput) {
    const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId: input.tenantId, dealNumber: input.dealNumber } } });
    if (!deal) throw new DealNotFoundError(input.dealNumber);

    const existingByKey = await this.prisma.payoffIssuance.findUnique({ where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existingByKey) return existingByKey;

    // AC: no orphan payoffs — the item's existence IS the proof this payoff is linked to a real deal (only created at S084 finalize time).
    const item = await this.prisma.dealOpenItem.findUnique({ where: { tenantId_itemType_itemNumber: { tenantId: input.tenantId, itemType: 'PAYOFF', itemNumber: input.dealNumber } } });
    if (!item) throw new OpenItemNotFoundError('PAYOFF', input.dealNumber);

    // AC: relieved exactly once — a second issuance attempt (different idempotencyKey) against an already-relieved item is refused.
    const existingForDeal = await this.prisma.payoffIssuance.findUnique({ where: { tenantId_dealId: { tenantId: input.tenantId, dealId: deal.id } } });
    if (existingForDeal || item.status === 'CLOSED') {
      throw new AlreadyRelievedError(`Deal "${input.dealNumber}"'s payoff item has already been issued/relieved — a second issuance is refused, not silently re-posted.`);
    }

    const eventId = `${input.dealNumber}:payoff-issuance`;
    const envelope = buildEnvelope({
      eventId, tenantId: input.tenantId, legalEntityId: deal.legalEntityId, eventType: PAYOFF_ISSUANCE_EVENT, occurredAt: new Date().toISOString(),
      sourceEntityType: 'DEAL', sourceEntityId: input.dealNumber, correlationId: `payoff:${input.dealNumber}`,
      businessDate: new Date().toISOString().slice(0, 10),
      payload: { dealNumber: input.dealNumber, payoffAmount: input.actualAmount },
    });
    const result = await this.postingEngine.submitEvent(envelope);
    if (result.status === 'REJECTED' || result.status === 'FAILED') {
      try {
        await this.postingRecovery.fileDeadLetter(envelope, {
          failureCategory: classifyCoaFailureReason(result.failureReason), failureCode: `PAYOFF_ISSUANCE_${result.status}`,
          failureStage: 'MAPPING', failureMessage: result.failureReason ?? 'unknown', occurredAt: new Date().toISOString(),
        }, { legalEntityId: deal.legalEntityId, storeId: deal.storeId, sourceTransactionId: input.dealNumber });
      } catch { /* best-effort */ }
    }

    const postingRecordId = randomUUID();
    const recapCents = toCents(item.originalAmount.toString());
    const actualCents = toCents(input.actualAmount);
    const varianceCents = computePayoffVarianceCents(recapCents, actualCents);
    const disposition = determinePayoffVarianceDisposition(recapCents, actualCents);

    const issuance = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, input.tenantId);
      await tx.dealPostingRecord.create({
        data: {
          id: postingRecordId, tenantId: input.tenantId, dealId: deal.id, segmentType: 'PAYOFF_ISSUANCE', eventId, eventType: PAYOFF_ISSUANCE_EVENT,
          correlationId: `payoff:${input.dealNumber}`, coaStatus: result.status, coaExecutionId: result.executionId ?? null,
          journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null,
          amountsJson: { actualAmountCents: actualCents }, createdBy: input.actor,
        },
      });
      if (result.status === 'POSTED') {
        await tx.dealOpenItemApplication.create({
          data: { id: randomUUID(), tenantId: input.tenantId, openItemId: item.id, amount: item.remainingBalance, sourceType: 'PAYOFF_ISSUANCE', sourceRecordId: postingRecordId, idempotencyKey: input.idempotencyKey, appliedBy: input.actor },
        });
        await tx.dealOpenItem.update({ where: { id: item.id }, data: { appliedAmount: item.originalAmount, remainingBalance: '0.00', status: 'CLOSED', closedAt: new Date() } });
      }

      const r = await tx.payoffIssuance.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, dealId: deal.id, recapPayoffAmount: item.originalAmount, actualAmount: input.actualAmount,
          varianceAmount: centsToDecimalString(varianceCents), varianceDisposition: disposition === 'NONE' ? 'NONE' : null,
          postingRecordId, idempotencyKey: input.idempotencyKey, issuedBy: input.actor,
        },
      });
      await appendAuditReference(tx, { tenantId: input.tenantId, docType: 'PAYOFF_ISSUANCE', docId: r.id, action: 'ISSUED', after: { dealNumber: input.dealNumber, actualAmount: input.actualAmount, varianceCents, coaStatus: result.status }, actor: input.actor });
      return r;
    });

    return issuance;
  }

  async dispositionVariance(tenantId: string, dealNumber: string, disposition: 'ADDITIONAL_PAYMENT' | 'REFUND_RECEIVABLE', reason: string, actor: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 500) throw new ReasonRequiredError('disposition a payoff variance');

    const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber } } });
    if (!deal) throw new DealNotFoundError(dealNumber);
    const issuance = await this.prisma.payoffIssuance.findUnique({ where: { tenantId_dealId: { tenantId, dealId: deal.id } } });
    if (!issuance) throw new OpenItemNotFoundError('PAYOFF_ISSUANCE', dealNumber);
    if (issuance.varianceDisposition && issuance.varianceDisposition !== 'NONE') {
      throw new AlreadyRelievedError(`Payoff variance for deal "${dealNumber}" was already dispositioned (${issuance.varianceDisposition}).`);
    }

    const varianceCents = Math.round(Number(issuance.varianceAmount) * 100);
    if (varianceCents === 0) throw new AlreadyRelievedError(`Deal "${dealNumber}" has no payoff variance to disposition.`);
    const expectedDisposition = determinePayoffVarianceDisposition(toCents(issuance.recapPayoffAmount.toString()), toCents(issuance.actualAmount.toString()));
    if (disposition !== expectedDisposition) {
      throw new Error(`Disposition "${disposition}" does not match the computed variance direction "${expectedDisposition}" for deal "${dealNumber}".`);
    }

    const eventId = `${dealNumber}:payoff-variance`;
    const envelope = buildEnvelope({
      eventId, tenantId, legalEntityId: deal.legalEntityId, eventType: PAYOFF_VARIANCE_EVENT, occurredAt: new Date().toISOString(),
      sourceEntityType: 'DEAL', sourceEntityId: dealNumber, correlationId: `payoff-variance:${dealNumber}`,
      businessDate: new Date().toISOString().slice(0, 10),
      payload: { dealNumber, disposition, varianceAmount: centsToDecimalString(Math.abs(varianceCents)) },
    });
    const result = await this.postingEngine.submitEvent(envelope);
    if (result.status === 'REJECTED' || result.status === 'FAILED') {
      try {
        await this.postingRecovery.fileDeadLetter(envelope, {
          failureCategory: classifyCoaFailureReason(result.failureReason), failureCode: `PAYOFF_VARIANCE_${result.status}`,
          failureStage: 'MAPPING', failureMessage: result.failureReason ?? 'unknown', occurredAt: new Date().toISOString(),
        }, { legalEntityId: deal.legalEntityId, storeId: deal.storeId, sourceTransactionId: dealNumber });
      } catch { /* best-effort */ }
    }

    const postingRecordId = randomUUID();
    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      await tx.dealPostingRecord.create({
        data: {
          id: postingRecordId, tenantId, dealId: deal.id, segmentType: 'PAYOFF_VARIANCE', eventId, eventType: PAYOFF_VARIANCE_EVENT,
          correlationId: `payoff-variance:${dealNumber}`, coaStatus: result.status, coaExecutionId: result.executionId ?? null,
          journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null,
          amountsJson: { varianceCents }, createdBy: actor,
        },
      });
      const r = await tx.payoffIssuance.update({ where: { id: issuance.id }, data: { varianceDisposition: disposition, varianceReason: trimmed } });
      await appendAuditReference(tx, { tenantId, docType: 'PAYOFF_ISSUANCE', docId: issuance.id, action: 'VARIANCE_DISPOSITIONED', after: { disposition, reason: trimmed, coaStatus: result.status }, actor });
      return r;
    });
    return updated;
  }
}

// S088 — CIT Funding Match. Lender funding receipt (CE-09 receipt
// origination — PENDING_UPSTREAM_TECHNICAL_RECONCILIATION, see the final
// delivery summary for the exact expected CE-09 contract) relieves this
// service's own local CIT DealOpenItem (real services/schedule-service
// integration is blocked by the verified platform gap documented on
// schema.prisma's Deal model). Short-funding variance is a disposition
// ceremony: FEE_WITHHELD posts a real expense leg through coa-service and
// closes the item; CONTRACT_ISSUE posts nothing and reopens the S085
// workflow state, leaving the item open pending a corrected receipt.

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { toCents, centsToDecimalString } from '../domain/money';
import { computeCitShortfallCents, verifyFeeWithheldConservation } from '../domain/conservation';
import { applyOpenItemAmountCents, deriveOpenItemStatus } from '../domain/open-item-math';
import { buildEnvelope } from '../domain/event-envelope';
import { IPostingEngineClient } from '../infrastructure/posting-engine-client';
import { IPostingRecoveryClient } from '../infrastructure/posting-recovery-client';
import { IScheduleServiceClient } from '../infrastructure/schedule-service-client';
import { classifyCoaFailureReason } from '../infrastructure/posting-failure-taxonomy';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { DealNotFoundError, OpenItemNotFoundError, AlreadyRelievedError, ReasonRequiredError } from './errors';

/** S088/S087 — schedule 87 (CIT Receivable), see scripts/seed-ce12-rule-packs.ts. */
export const CIT_SCHEDULE_NUMBER = '87';

export interface RecordCitFundingInput {
  tenantId: string;
  dealNumber: string;
  amount: string; // decimal string
  lenderRef: string;
  receivedAt: string; // ISO
  idempotencyKey: string;
  actor: string;
}

export const CIT_SHORT_FUND_FEE_EVENT = 'deal.cit-short-fund-fee.v1';

@injectable()
export class CitFundingService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IPostingEngineClient') private readonly postingEngine: IPostingEngineClient,
    @inject('IPostingRecoveryClient') private readonly postingRecovery: IPostingRecoveryClient,
    // Optional — real deployments (index.ts) register a real
    // HttpScheduleServiceClient; tests that construct this service directly
    // (tests/live-db's fake-boundary suite) omit it and get the local
    // DealOpenItem value only, exactly as before this gap-closure pass.
    @inject('IScheduleServiceClient') private readonly scheduleClient?: IScheduleServiceClient,
  ) {}

  /** Overrides `remainingBalance`/`status` on a CIT item with the REAL
   * schedule-service open item when reachable — authoritative per the
   * gap-closure instructions; the local DealOpenItem stays the lineage/audit
   * record and is returned unmodified if schedule-service has no matching
   * item (not yet bridged for this tenant, or unreachable). */
  private async withAuthoritativeBalance(tenantId: string, item: any): Promise<any> {
    if (!this.scheduleClient) return item;
    const real = await this.scheduleClient.getOpenItems(tenantId, CIT_SCHEDULE_NUMBER, item.itemNumber);
    if (!real || real.length === 0) return item;
    // Multiple real items can exist per control number over a deal's life
    // (recontract, disposition) — sum remaining balance, OPEN if any remain.
    const remainingBalance = real.reduce((sum, r) => sum + Number(r.remainingBalance), 0).toFixed(2);
    const status = real.every((r) => r.status === 'CLOSED') ? 'CLOSED' : 'OPEN';
    return { ...item, remainingBalance, status, scheduleServiceAuthoritative: true };
  }

  async recordFundingReceipt(input: RecordCitFundingInput) {
    const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId: input.tenantId, dealNumber: input.dealNumber } } });
    if (!deal) throw new DealNotFoundError(input.dealNumber);

    const existing = await this.prisma.citFundingReceipt.findUnique({ where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing;

    const item = await this.prisma.dealOpenItem.findUnique({ where: { tenantId_itemType_itemNumber: { tenantId: input.tenantId, itemType: 'CIT', itemNumber: input.dealNumber } } });
    if (!item) throw new OpenItemNotFoundError('CIT', input.dealNumber);
    if (item.status === 'CLOSED') throw new AlreadyRelievedError(`CIT item for deal "${input.dealNumber}" is already fully relieved — a second funding attempt is refused, not silently re-applied.`);

    const originalCents = toCents(item.originalAmount.toString());
    const remainingCents = toCents(item.remainingBalance.toString());
    const receivedCents = toCents(input.amount);
    const applyCents = Math.min(receivedCents, remainingCents); // never over-apply this item

    const newRemainingCents = applyOpenItemAmountCents(originalCents, remainingCents, applyCents);
    const newStatus = deriveOpenItemStatus(originalCents, newRemainingCents);
    const shortfallCents = computeCitShortfallCents(remainingCents, receivedCents);

    const receipt = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, input.tenantId);
      await tx.dealOpenItemApplication.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, openItemId: item.id, amount: centsToDecimalString(applyCents),
          sourceType: 'CIT_FUNDING', idempotencyKey: input.idempotencyKey, appliedBy: input.actor, note: `Lender funding receipt ${input.lenderRef}`,
        },
      });
      await tx.dealOpenItem.update({
        where: { id: item.id },
        data: { appliedAmount: centsToDecimalString(toCents(item.appliedAmount.toString()) + applyCents), remainingBalance: centsToDecimalString(newRemainingCents), status: newStatus, closedAt: newStatus === 'CLOSED' ? new Date() : null },
      });
      await tx.deal.update({ where: { id: deal.id }, data: { fundedFlag: true } });

      const r = await tx.citFundingReceipt.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, dealId: deal.id, amount: input.amount, lenderRef: input.lenderRef,
          receivedAt: new Date(input.receivedAt), citOriginalAmount: item.originalAmount, shortfallAmount: centsToDecimalString(shortfallCents),
          status: shortfallCents > 0 ? 'SHORT_FUNDED_PENDING_DISPOSITION' : 'MATCHED',
          idempotencyKey: input.idempotencyKey, createdBy: input.actor,
        },
      });
      await appendAuditReference(tx, {
        tenantId: input.tenantId, docType: 'CIT_FUNDING_RECEIPT', docId: r.id, action: 'RECORDED',
        after: { dealNumber: input.dealNumber, amount: input.amount, shortfallCents, newStatus }, actor: input.actor,
      });
      return r;
    });

    return receipt;
  }

  async dispositionShortfall(tenantId: string, receiptId: string, dispositionType: 'FEE_WITHHELD' | 'CONTRACT_ISSUE', reason: string, actor: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 1 || trimmed.length > 500) throw new ReasonRequiredError('disposition a CIT short-fund variance');

    const receipt = await this.prisma.citFundingReceipt.findFirst({ where: { id: receiptId, tenantId } });
    if (!receipt) throw new OpenItemNotFoundError('CIT_FUNDING_RECEIPT', receiptId);
    if (receipt.status !== 'SHORT_FUNDED_PENDING_DISPOSITION') {
      throw new AlreadyRelievedError(`CIT funding receipt "${receiptId}" is not pending disposition (status: ${receipt.status}).`);
    }

    const deal = await this.prisma.deal.findUnique({ where: { id: receipt.dealId } });
    const item = await this.prisma.dealOpenItem.findUnique({ where: { tenantId_itemType_itemNumber: { tenantId, itemType: 'CIT', itemNumber: deal!.dealNumber } } });
    if (!item) throw new OpenItemNotFoundError('CIT', deal!.dealNumber);

    if (dispositionType === 'FEE_WITHHELD') {
      const shortfallCents = toCents(receipt.shortfallAmount.toString());
      const receivedCents = toCents(receipt.amount.toString());
      const originalCents = toCents(receipt.citOriginalAmount.toString());
      if (!verifyFeeWithheldConservation(originalCents, receivedCents, shortfallCents)) {
        throw new Error(`Internal conservation check failed for CIT fee-withheld disposition on receipt ${receiptId}.`);
      }

      const eventId = `${deal!.dealNumber}:cit-short-fund-fee:${receiptId}`;
      const envelope = buildEnvelope({
        eventId, tenantId, legalEntityId: deal!.legalEntityId, eventType: CIT_SHORT_FUND_FEE_EVENT, occurredAt: new Date().toISOString(),
        sourceEntityType: 'DEAL', sourceEntityId: deal!.dealNumber, correlationId: `cit-disposition:${receiptId}`,
        businessDate: new Date().toISOString().slice(0, 10),
        payload: { dealNumber: deal!.dealNumber, feeAmount: centsToDecimalString(shortfallCents) },
      });
      const result = await this.postingEngine.submitEvent(envelope);
      if (result.status === 'REJECTED' || result.status === 'FAILED') {
        try {
          await this.postingRecovery.fileDeadLetter(envelope, {
            failureCategory: classifyCoaFailureReason(result.failureReason), failureCode: `CIT_SHORT_FUND_FEE_${result.status}`,
            failureStage: 'MAPPING', failureMessage: result.failureReason ?? 'unknown', occurredAt: new Date().toISOString(),
          }, { legalEntityId: deal!.legalEntityId, storeId: deal!.storeId, sourceTransactionId: deal!.dealNumber });
        } catch { /* best-effort */ }
      }

      const postingRecordId = randomUUID();
      const updated = await this.prisma.$transaction(async (tx: any) => {
        await setTenantContextOnConnection(tx, tenantId);
        await tx.dealPostingRecord.create({
          data: {
            id: postingRecordId, tenantId, dealId: deal!.id, segmentType: 'CIT_SHORT_FUND_FEE', eventId, eventType: CIT_SHORT_FUND_FEE_EVENT,
            correlationId: `cit-disposition:${receiptId}`, coaStatus: result.status, coaExecutionId: result.executionId ?? null,
            journalEntryId: result.journalEntryId ?? null, journalNumber: result.journalNumber ?? null, failureReason: result.failureReason ?? null,
            amountsJson: { feeAmountCents: shortfallCents }, createdBy: actor,
          },
        });
        if (result.status === 'POSTED') {
          await tx.dealOpenItemApplication.create({
            data: { id: randomUUID(), tenantId, openItemId: item.id, amount: centsToDecimalString(shortfallCents), sourceType: 'CIT_SHORT_FUND_FEE', sourceRecordId: postingRecordId, idempotencyKey: `${receiptId}:fee-withheld`, appliedBy: actor, note: trimmed },
          });
          await tx.dealOpenItem.update({ where: { id: item.id }, data: { appliedAmount: item.originalAmount, remainingBalance: '0.00', status: 'CLOSED', closedAt: new Date() } });
        }
        const r = await tx.citFundingReceipt.update({
          where: { id: receiptId },
          data: { status: 'SHORT_FUNDED_FEE_WITHHELD', dispositionType, dispositionReason: trimmed, dispositionedBy: actor, dispositionedAt: new Date(), feePostingRecordId: postingRecordId },
        });
        await appendAuditReference(tx, { tenantId, docType: 'CIT_FUNDING_RECEIPT', docId: receiptId, action: 'DISPOSITIONED_FEE_WITHHELD', after: { feeAmountCents: shortfallCents, coaStatus: result.status }, actor });
        return r;
      });
      return updated;
    }

    // CONTRACT_ISSUE — no fee posted; item stays open; reopen the S085 workflow state.
    const updated = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, tenantId);
      const r = await tx.citFundingReceipt.update({
        where: { id: receiptId },
        data: { status: 'SHORT_FUNDED_RETURNED_TO_BILLER', dispositionType, dispositionReason: trimmed, dispositionedBy: actor, dispositionedAt: new Date() },
      });
      const reviewCase = await tx.dealReviewCase.findUnique({ where: { tenantId_dealId_recapVersion: { tenantId, dealId: deal!.id, recapVersion: deal!.currentRecapVersion } } });
      if (reviewCase) {
        await tx.dealReviewCase.update({ where: { id: reviewCase.id }, data: { status: 'PENDING_REVIEW', returnedReason: `CIT short-fund contract issue: ${trimmed}`, returnedBy: actor, returnedAt: new Date() } });
      }
      await appendAuditReference(tx, { tenantId, docType: 'CIT_FUNDING_RECEIPT', docId: receiptId, action: 'DISPOSITIONED_CONTRACT_ISSUE', after: { reason: trimmed }, actor });
      return r;
    });
    return updated;
  }

  async listAging(tenantId: string, thresholdDays?: number) {
    const config = await this.prisma.dealTenantConfig.findUnique({ where: { tenantId } });
    const threshold = thresholdDays ?? config?.citFundingDelayThresholdDays ?? 5;
    const items = await this.prisma.dealOpenItem.findMany({ where: { tenantId, itemType: 'CIT', status: { not: 'CLOSED' } } });
    const now = Date.now();
    const withAge = items.map((i: any) => ({ ...i, ageDays: Math.floor((now - new Date(i.createdAt).getTime()) / 86400000) }));
    const authoritative = await Promise.all(withAge.map((i: any) => this.withAuthoritativeBalance(tenantId, i)));
    return authoritative.filter((i: any) => i.ageDays >= threshold && i.status !== 'CLOSED');
  }

  /** Gap-closure — GET list endpoint for CIT funding receipts (previously
   * only POST /cit/funding-receipts existed; there was no way to browse
   * receipts already recorded). Real persisted DB data, paginated. */
  async listFundingReceipts(tenantId: string, filter: { dealNumber?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
    const where: any = { tenantId };
    if (filter.status) where.status = filter.status;
    if (filter.dealNumber) {
      const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId, dealNumber: filter.dealNumber } } });
      where.dealId = deal?.id ?? '__no-match__';
    }
    const [items, total] = await Promise.all([
      this.prisma.citFundingReceipt.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.citFundingReceipt.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /** Gap-closure — Sold-Not-Funded (SNF) explicit view: delivered deals
   * (POSTED, i.e. released) whose CIT item is still open beyond the
   * funding-delay threshold. Reuses the same aging logic as listAging but
   * joins Deal so the response is explicitly SNF-shaped (dealNumber,
   * dealType, deal status) rather than a bare open-item row. */
  async listSoldNotFunded(tenantId: string, thresholdDays?: number) {
    const config = await this.prisma.dealTenantConfig.findUnique({ where: { tenantId } });
    const threshold = thresholdDays ?? config?.citFundingDelayThresholdDays ?? 5;
    const items = await this.prisma.dealOpenItem.findMany({ where: { tenantId, itemType: 'CIT', status: { not: 'CLOSED' } } });
    const now = Date.now();
    const withAge = items.map((i: any) => ({ ...i, ageDays: Math.floor((now - new Date(i.createdAt).getTime()) / 86400000) }));
    const authoritative = await Promise.all(withAge.map((i: any) => this.withAuthoritativeBalance(tenantId, i)));
    const aged = authoritative.filter((i: any) => i.ageDays >= threshold && i.status !== 'CLOSED');
    if (aged.length === 0) return [];
    const deals = await this.prisma.deal.findMany({ where: { tenantId, id: { in: aged.map((i: any) => i.dealId) }, status: 'POSTED' } });
    const dealsById = new Map(deals.map((d: any) => [d.id, d]));
    return aged
      .filter((i: any) => dealsById.has(i.dealId))
      .map((i: any) => ({ ...i, deal: dealsById.get(i.dealId) }));
  }
}

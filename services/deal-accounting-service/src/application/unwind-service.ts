// S086 — Deal Unwind: full cancellation post-posting. S218-linked symmetric
// reversal of every journal segment this deal produced (core + trade +
// CIT/reserve/fees/tax/rebate + each product line), CIT item closed
// locally (this service owns creating/closing it — see schema.prisma's
// DealOpenItem doc comment), trade-in reversed via a symmetric PUTR event,
// products flagged for S093 (fni-reserve-service), reserve flagged for its
// own S091 reversal/chargeback (fni-reserve-service) — both emitted, never
// executed here (this service does not own that ledger).
//
// Guard: if CIT funding has ALREADY been applied (DealOpenItem CIT
// appliedAmount > 0), the unwind is REFUSED outright — named, audited,
// 409 — the correct path is S087 recontract, never a raw unwind once real
// lender money has moved.

import { randomUUID } from 'crypto';
import { injectable, inject } from 'tsyringe';
import type { PrismaClient } from '.prisma/deal-accounting-client';
import { DealRecapPayload } from '../domain/recap';
import { IJournalReversalClient } from '../infrastructure/journal-reversal-client';
import { writePutrOutboxEvent, PUTR_EVENT_TYPES } from '../infrastructure/putr-outbox';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';
import { appendAuditReference } from '../infrastructure/audit';
import { DealNotFoundError, RecapNotFoundError, FundedUnwindRefusedError, ReasonRequiredError } from './errors';

export interface UnwindDealInput {
  tenantId: string;
  dealNumber: string;
  recapVersion?: number; // defaults to the deal's current recap version
  reason: string;
  actor: string;
}

@injectable()
export class UnwindService {
  constructor(
    @inject('PrismaClient') private readonly prisma: PrismaClient,
    @inject('IJournalReversalClient') private readonly reversalClient: IJournalReversalClient,
  ) {}

  async unwind(input: UnwindDealInput) {
    const trimmedReason = (input.reason ?? '').trim();
    if (trimmedReason.length < 1 || trimmedReason.length > 500) throw new ReasonRequiredError('unwind a deal');

    const deal = await this.prisma.deal.findUnique({ where: { tenantId_dealNumber: { tenantId: input.tenantId, dealNumber: input.dealNumber } } });
    if (!deal) throw new DealNotFoundError(input.dealNumber);
    const recapVersion = input.recapVersion ?? deal.currentRecapVersion;
    const recap = await this.prisma.dealRecap.findUnique({ where: { tenantId_dealId_recapVersion: { tenantId: input.tenantId, dealId: deal.id, recapVersion } } });
    if (!recap) throw new RecapNotFoundError(input.dealNumber, recapVersion);

    const idempotencyKey = `${input.tenantId}:${input.dealNumber}:unwind:v${recapVersion}`;
    const existing = await this.prisma.dealUnwind.findUnique({ where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey } } });
    if (existing) return existing;

    // ── Guard: funded-unwind refusal (named, audited) ──────────────────────
    const citItem = await this.prisma.dealOpenItem.findUnique({
      where: { tenantId_itemType_itemNumber: { tenantId: input.tenantId, itemType: 'CIT', itemNumber: input.dealNumber } },
    });
    if (citItem && Number(citItem.appliedAmount) > 0) {
      await appendAuditReference(this.prisma, {
        tenantId: input.tenantId, docType: 'DEAL', docId: deal.id, action: 'UNWIND_REFUSED_FUNDED',
        after: { dealNumber: input.dealNumber, recapVersion, appliedAmount: citItem.appliedAmount.toString() },
        actor: input.actor,
      });
      const refusal = await this.prisma.dealUnwind.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, dealId: deal.id, recapVersion,
          status: 'REFUSED', reason: trimmedReason,
          refusalCode: 'FUNDED_UNWIND_REFUSED',
          refusalDetail: `CIT item for deal ${input.dealNumber} has ${citItem.appliedAmount.toString()} already applied (funding received) — unwind refused. Use the S087 recontract path.`,
          idempotencyKey, executedBy: input.actor,
        },
      });
      throw Object.assign(new FundedUnwindRefusedError(input.dealNumber), { unwindRecordId: refusal.id });
    }

    // ── Reverse every POSTED segment for this deal+recapVersion ─────────────
    const postingRecords = await this.prisma.dealPostingRecord.findMany({
      where: { tenantId: input.tenantId, dealId: deal.id, recapVersion, coaStatus: 'POSTED', reversedAt: null },
    });

    const reversalPostingRecordIds: string[] = [];
    for (const record of postingRecords) {
      if (!record.journalEntryId) continue;
      const reversal = await this.reversalClient.reverse(input.tenantId, record.journalEntryId, `S086 unwind: ${trimmedReason}`);
      await this.prisma.dealPostingRecord.update({
        where: { id: record.id },
        data: { reversalJournalEntryId: reversal.reversalId, reversalJournalNumber: reversal.reversalNumber, reversedAt: new Date() },
      });
      reversalPostingRecordIds.push(record.id);
    }

    // ── Close the CIT item locally (this service's own ledger — no funding was applied, guard above proved it) ──
    if (citItem && citItem.status !== 'CLOSED') {
      await this.prisma.$transaction(async (tx: any) => {
        await setTenantContextOnConnection(tx, input.tenantId);
        await tx.dealOpenItemApplication.create({
          data: {
            id: randomUUID(), tenantId: input.tenantId, openItemId: citItem.id,
            amount: citItem.remainingBalance, sourceType: 'UNWIND_CLOSE', sourceRecordId: deal.id,
            idempotencyKey: `${idempotencyKey}:cit-close`, appliedBy: input.actor, note: 'Closed by S086 unwind',
          },
        });
        await tx.dealOpenItem.update({ where: { id: citItem.id }, data: { appliedAmount: citItem.originalAmount, remainingBalance: '0.00', status: 'CLOSED', closedAt: new Date() } });
      });
    }

    // ── Symmetric trade-in reversal + S093/S091 flags (emitted, not executed here) ──
    const payload = recap.payload as unknown as DealRecapPayload;
    const correlationId = `unwind:${input.dealNumber}:v${recapVersion}`;
    await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, input.tenantId);
      if (payload.hasTradeIn) {
        await writePutrOutboxEvent(tx, input.tenantId, PUTR_EVENT_TYPES.TRADE_IN_RECEIPT_REVERSED, input.dealNumber, {
          dealNumber: input.dealNumber, recapVersion, tradeVin: payload.tradeVin, tradeAcvAmount: payload.tradeAcvAmount, reason: trimmedReason,
        }, correlationId);
      }
      for (const line of payload.products ?? []) {
        await writePutrOutboxEvent(tx, input.tenantId, PUTR_EVENT_TYPES.PRODUCT_CANCELLATION_FLAGGED, input.dealNumber, {
          dealNumber: input.dealNumber, recapVersion, productCode: line.productCode, providerRef: line.providerRef, reason: `S086 unwind: ${trimmedReason}`,
        }, correlationId);
      }
      if (payload.reserveIncomeAmount) {
        await writePutrOutboxEvent(tx, input.tenantId, PUTR_EVENT_TYPES.RESERVE_CHARGEBACK_FLAGGED, input.dealNumber, {
          dealNumber: input.dealNumber, recapVersion, reserveIncomeAmount: payload.reserveIncomeAmount, reason: `S086 unwind: ${trimmedReason}`,
        }, correlationId);
      }
    });

    const unwind = await this.prisma.$transaction(async (tx: any) => {
      await setTenantContextOnConnection(tx, input.tenantId);
      const u = await tx.dealUnwind.create({
        data: {
          id: randomUUID(), tenantId: input.tenantId, dealId: deal.id, recapVersion,
          status: 'COMPLETED', reason: trimmedReason,
          reversalPostingRecordIds: reversalPostingRecordIds as any,
          idempotencyKey, executedBy: input.actor,
        },
      });
      await tx.deal.update({ where: { id: deal.id }, data: { status: 'UNWOUND' } });
      await appendAuditReference(tx, {
        tenantId: input.tenantId, docType: 'DEAL', docId: deal.id, action: 'UNWOUND',
        after: { dealNumber: input.dealNumber, recapVersion, reversedSegments: reversalPostingRecordIds.length },
        actor: input.actor,
      });
      return u;
    });

    return unwind;
  }
}

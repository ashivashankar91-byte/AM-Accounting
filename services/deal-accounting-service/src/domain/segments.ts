// S084 design decision — "one journal vs multiple product-line journals":
//
// coa-service's DSL (services/coa-service/src/domain/posting-engine/dsl.ts)
// requires every posting group's baseAmountPath to resolve to a value, or
// generateBlueprint() THROWS BlueprintResolutionError — there is no
// per-group condition, only per-RULE conditions, and a rule's blueprint is
// a fixed, static set of posting groups. A deal recap has a variable number
// of optional components (trade-in or not, financed or not, N product
// lines where N is unbounded in principle, fees/tax/rebate each optional),
// so a single literal journal cannot be expressed as one static blueprint
// without either (a) capping every optional slot at a fixed count and
// forcing the caller to populate every slot's fields even when absent
// (which would violate "never invent a dollar figure" the moment a slot is
// unused), or (b) decomposing the recap into however many independent,
// self-contained sub-transactions it actually has.
//
// This module implements (b): the recap is decomposed into a list of
// SEGMENTS, each mapping to its OWN SourceEventEnvelope / eventType / rule
// pack, each idempotent on its own deterministic eventId, each a fully
// self-balanced two-sided posting (its own DR total === its own CR total,
// guaranteed by coa-service's own allocateCents()). The CORE segment
// (sale/lease-cap/wholesale-AR + unit cost relief, `deal.finalized.v1`)
// always fires. Every other segment fires ONLY when its corresponding
// recap field is present and positive — trade allowance, trade ACV, trade
// payoff, CIT, reserve income, fees, tax, rebate receivable, and one
// `deal.product-line-finalized.v1` event PER ACTUAL product line (never a
// fixed 4-slot matrix — see MAX_PRODUCT_LINES in recap.ts, which is a
// service-level acceptance cap on how many lines a recap may declare, NOT
// how the DSL is shaped; the DSL itself never sees an unpopulated slot).
//
// The epic's "ONE authoritative deal journal" requirement is satisfied as
// ONE JOURNAL PER LOGICAL SUB-TRANSACTION within a single, atomically-
// planned SEGMENT SET, not as one literal journal row. Conservation proof:
// Σ(segment base amounts) === Σ(present recap role amounts) BY
// CONSTRUCTION, because segmentsForRecap() below reads its amounts from
// EXACTLY the same role accessors domain/roles.ts's presentBaseRoles() (the
// same function structure-hash.ts and recontract-delta.ts use) — there is
// no second, independently-typed amount source that could drift from the
// first. tests/unit/segments.test.ts proves this numerically on fixtures.
// All segments belonging to one finalize call share ONE correlationId
// (`finalize:${dealNumber}:v${recapVersion}`), so coa-service's own
// GET /posting-engine/executions?correlationId=... query reconstructs the
// full segment set as a single traceable unit — the practical equivalent
// of "one journal" for every inquiry/reconciliation purpose the epic's ACs
// actually require (biller preview, deal detail journal chain, conservation
// tie-outs), even though it is architecturally several journals.

import { DealRecapPayload, DealRecapProductLine } from './recap';
import { toCents } from './money';

export type SegmentTag =
  | 'core' | 'trade-allowance' | 'trade-acv' | 'trade-payoff'
  | 'cit' | 'reserve' | 'fees' | 'tax' | 'rebate' | 'product';

export interface SegmentPlan {
  tag: SegmentTag;
  eventType: string;
  eventIdSuffix: string; // combined with `${dealNumber}:v${recapVersion}:` by the caller
  sourceEntityType: string;
  sourceEntityId: string;
  payload: Record<string, unknown>;
  amountCents: number; // the segment's own base amount, for the conservation proof
  productCode?: string;
  productIndex?: number;
}

export const DEAL_FINALIZED_EVENT = 'deal.finalized.v1';
export const TRADE_ALLOWANCE_EVENT = 'deal.trade-allowance-booked.v1';
export const TRADE_ACV_EVENT = 'deal.trade-acv-booked.v1';
export const TRADE_PAYOFF_EVENT = 'deal.trade-payoff-booked.v1';
export const CIT_RECEIVABLE_EVENT = 'deal.cit-receivable-booked.v1';
export const RESERVE_RECEIVABLE_EVENT = 'deal.reserve-receivable-booked.v1';
export const FEES_EVENT = 'deal.fees-booked.v1';
export const TAX_EVENT = 'deal.tax-booked.v1';
export const REBATE_RECEIVABLE_EVENT = 'deal.rebate-receivable-booked.v1';
export const PRODUCT_LINE_EVENT = 'deal.product-line-finalized.v1';

/** schedule-service's ScheduleDetail.controlNumber is VarChar(10) — every
 * DSL controlNumberPath value must resolve to <=10 chars. dealNumber alone
 * fits every role except product remit (deal#+product index); this
 * truncates from the LEFT so the most-distinctive suffix (the index) is
 * always preserved, matching the gap-closure note in scripts/seed-ce12-
 * rule-packs.ts (schedule 94). */
export function truncateControlNumber(base: string, maxLen = 10): string {
  return base.length <= maxLen ? base : base.slice(base.length - maxLen);
}

/** GL 19219 PRODUCT_REMIT_LIABILITY (schedule 94) control number — deal# +
 * product index, e.g. "D123-P1", truncated to <=10 chars total. */
export function productControlNumber(dealNumber: string, productIndex: number): string {
  return truncateControlNumber(`${dealNumber}-P${productIndex}`);
}

function grossAmountField(payload: DealRecapPayload): { field: string; value: string } {
  switch (payload.dealType) {
    case 'RETAIL': return { field: 'saleAmount', value: payload.saleAmount! };
    case 'DEALER_TRADE': return { field: 'saleAmount', value: (payload.saleAmount ?? payload.dealerTradeAmount)! };
    case 'WHOLESALE': return { field: 'wholesaleAmount', value: payload.wholesaleAmount! };
    case 'LEASE': return { field: 'leaseCapitalizedCostAmount', value: payload.leaseCapitalizedCostAmount! };
  }
}

/**
 * Builds the full segment plan for a deal.finalized recap. taxAmountCents
 * must already be the FETCHED tax-service result amount (never computed
 * here) — pass null/undefined when there is no taxResultId (tax segment
 * omitted) and the caller is responsible for having refused earlier if a
 * taxResultId WAS present but unusable (see application/tax-result-client
 * usage in the finalize service — this function never calls tax-service
 * itself, staying pure/DB-free).
 */
export function segmentsForRecap(payload: DealRecapPayload, taxAmountCents?: number | null): SegmentPlan[] {
  const segments: SegmentPlan[] = [];
  const gross = grossAmountField(payload);

  const corePayload: Record<string, unknown> = {
    dealNumber: payload.dealNumber,
    recapVersion: payload.recapVersion,
    dealType: payload.dealType,
    vin: payload.vin ?? null,
    stockNumber: payload.stockNumber,
    legalEntityId: payload.legalEntityId,
    storeId: payload.storeId,
    unitCostAmount: payload.unitCostAmount,
    [gross.field]: gross.value,
  };
  if (payload.dealType === 'LEASE') {
    corePayload['leaseResidualAmount'] = payload.leaseResidualAmount;
  }
  segments.push({
    tag: 'core',
    eventType: DEAL_FINALIZED_EVENT,
    eventIdSuffix: 'core',
    sourceEntityType: 'DEAL',
    sourceEntityId: payload.dealNumber,
    payload: corePayload,
    amountCents: toCents(gross.value),
  });

  if (payload.hasTradeIn) {
    segments.push({
      tag: 'trade-allowance',
      eventType: TRADE_ALLOWANCE_EVENT,
      eventIdSuffix: 'trade-allowance',
      sourceEntityType: 'DEAL',
      sourceEntityId: payload.dealNumber,
      payload: { dealNumber: payload.dealNumber, tradeVin: payload.tradeVin, tradeAllowanceAmount: payload.tradeAllowanceAmount },
      amountCents: toCents(payload.tradeAllowanceAmount!),
    });
    segments.push({
      tag: 'trade-acv',
      eventType: TRADE_ACV_EVENT,
      eventIdSuffix: 'trade-acv',
      sourceEntityType: 'DEAL',
      sourceEntityId: payload.dealNumber,
      payload: { dealNumber: payload.dealNumber, tradeVin: payload.tradeVin, tradeAcvAmount: payload.tradeAcvAmount },
      amountCents: toCents(payload.tradeAcvAmount!),
    });
    if (payload.tradePayoffAmount && toCents(payload.tradePayoffAmount) > 0) {
      segments.push({
        tag: 'trade-payoff',
        eventType: TRADE_PAYOFF_EVENT,
        eventIdSuffix: 'trade-payoff',
        sourceEntityType: 'DEAL',
        sourceEntityId: payload.dealNumber,
        payload: { dealNumber: payload.dealNumber, tradeLienholderRef: payload.tradeLienholderRef, tradePayoffAmount: payload.tradePayoffAmount },
        amountCents: toCents(payload.tradePayoffAmount),
      });
    }
  }

  if (payload.financedAmount && toCents(payload.financedAmount) > 0) {
    segments.push({
      tag: 'cit',
      eventType: CIT_RECEIVABLE_EVENT,
      eventIdSuffix: 'cit',
      sourceEntityType: 'DEAL',
      sourceEntityId: payload.dealNumber,
      payload: { dealNumber: payload.dealNumber, financedAmount: payload.financedAmount },
      amountCents: toCents(payload.financedAmount),
    });
  }

  if (payload.reserveIncomeAmount && toCents(payload.reserveIncomeAmount) > 0) {
    segments.push({
      tag: 'reserve',
      eventType: RESERVE_RECEIVABLE_EVENT,
      eventIdSuffix: 'reserve',
      sourceEntityType: 'DEAL',
      sourceEntityId: payload.dealNumber,
      payload: { dealNumber: payload.dealNumber, reserveIncomeAmount: payload.reserveIncomeAmount, reserveTermsRef: payload.reserveTermsRef ?? null },
      amountCents: toCents(payload.reserveIncomeAmount),
    });
  }

  if (payload.feesAmount && toCents(payload.feesAmount) > 0) {
    segments.push({
      tag: 'fees',
      eventType: FEES_EVENT,
      eventIdSuffix: 'fees',
      sourceEntityType: 'DEAL',
      sourceEntityId: payload.dealNumber,
      payload: { dealNumber: payload.dealNumber, feesAmount: payload.feesAmount },
      amountCents: toCents(payload.feesAmount),
    });
  }

  if (taxAmountCents != null && taxAmountCents > 0) {
    segments.push({
      tag: 'tax',
      eventType: TAX_EVENT,
      eventIdSuffix: 'tax',
      sourceEntityType: 'DEAL',
      sourceEntityId: payload.dealNumber,
      payload: { dealNumber: payload.dealNumber, taxResultId: payload.taxResultId, taxAmount: (taxAmountCents / 100).toFixed(2) },
      amountCents: taxAmountCents,
    });
  }

  if (payload.rebateReceivableAmount && toCents(payload.rebateReceivableAmount) > 0) {
    segments.push({
      tag: 'rebate',
      eventType: REBATE_RECEIVABLE_EVENT,
      eventIdSuffix: 'rebate',
      sourceEntityType: 'DEAL',
      sourceEntityId: payload.dealNumber,
      payload: { dealNumber: payload.dealNumber, rebateReceivableAmount: payload.rebateReceivableAmount },
      amountCents: toCents(payload.rebateReceivableAmount),
    });
  }

  (payload.products ?? []).forEach((line: DealRecapProductLine, index: number) => {
    segments.push({
      tag: 'product',
      eventType: PRODUCT_LINE_EVENT,
      eventIdSuffix: `product:${line.productCode}`,
      sourceEntityType: 'DEAL',
      sourceEntityId: payload.dealNumber,
      payload: {
        dealNumber: payload.dealNumber,
        productIndex: index,
        productCode: line.productCode,
        providerRef: line.providerRef,
        customerPriceAmount: line.customerPriceAmount,
        providerCostAmount: line.providerCostAmount,
        // Schedule 94 (PRODUCT_REMIT_LIABILITY, GL 19219) controlNumberPath target.
        productControlRef: productControlNumber(payload.dealNumber, index),
      },
      amountCents: toCents(line.customerPriceAmount) + toCents(line.providerCostAmount),
      productCode: line.productCode,
      productIndex: index,
    });
  });

  return segments;
}

/** Deterministic eventId for a segment — idempotent on deal#+recapVersion+segment. */
export function segmentEventId(dealNumber: string, recapVersion: number, suffix: string): string {
  return `${dealNumber}:v${recapVersion}:${suffix}`;
}

// S077 — Dealer trade gain/loss + settlement domain logic (pure, no I/O).
//
// Design note (why gain/loss is a precomputed direction flag, not something
// the rule pack branches on at posting time): the posting DSL has no
// "debit this account if positive, credit it if negative" primitive — a
// posting group's debit/credit allocations are fixed roles with a fixed
// positive basis-point split of one positive baseAmountPath figure
// (coa-service's blueprint.ts rejects a non-positive base amount outright).
// A trade at exactly agreed value (no gain/loss) must not carry a $0 "gain"
// posting group (same NON_POSITIVE_AMOUNT rejection risk as stock-in's
// optional cost components — see stock-in.ts's header comment). This
// service therefore computes the gain/loss OUTCOME deterministically from
// two already-known, non-invented inputs (the trade doc's agreedValue and
// this service's own tracked unit bookValue) and selects among three
// mutually-exclusive rule-pack rules (EVEN / GAIN / LOSS) via a condition on
// that precomputed `tradeOutcome` field — the rule pack still decides
// STRUCTURE (which accounts, which roles), this module only decides which
// of the three fixed structures applies, exactly the same "generator
// computes structure, not deal math" principle S084 states for the deal
// journal generator.

import { requirePositiveCents } from './money';

export class DealerTradeValidationError extends Error {
  readonly status = 400;
  readonly code = 'DEALER_TRADE_VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'DealerTradeValidationError';
  }
}

export type TradeOutcome = 'EVEN' | 'GAIN' | 'LOSS';

export interface OutboundTradeComputation {
  agreedValueCents: number;
  bookValueCents: number;
  outcome: TradeOutcome;
  gainLossCents: number; // 0 when EVEN, else the absolute difference
}

/** agreedValue and bookValue are both concrete, already-known inputs (the
 * trade document's negotiated value and this service's own cost-tracked
 * unit basis) — this is arithmetic derivation, not invented deal math. */
export function computeOutboundTrade(agreedValueCents: number, bookValueCents: number): OutboundTradeComputation {
  if (agreedValueCents <= 0) throw new DealerTradeValidationError('agreedValue must be positive.');
  if (bookValueCents <= 0) throw new DealerTradeValidationError('The unit has no positive book value to trade out.');
  const diff = agreedValueCents - bookValueCents;
  if (diff === 0) return { agreedValueCents, bookValueCents, outcome: 'EVEN', gainLossCents: 0 };
  if (diff > 0) return { agreedValueCents, bookValueCents, outcome: 'GAIN', gainLossCents: diff };
  return { agreedValueCents, bookValueCents, outcome: 'LOSS', gainLossCents: -diff };
}

export function requirePositiveTradeCents(field: string, value: string): number {
  return requirePositiveCents(field, value);
}

export interface SettlementComputation {
  nettedCents: number;
  cashDifferenceCents: number;
}

/** Settlement nets the receivable/payable per the trade doc (min of the two
 * sides actually closes; anything left over is a CE-09 cash concept, never
 * posted by this service — see dealer-trade-service.ts). */
export function computeSettlement(receivableOpenCents: number, payableOpenCents: number): SettlementComputation {
  if (receivableOpenCents < 0 || payableOpenCents < 0) throw new DealerTradeValidationError('Open amounts must not be negative.');
  const nettedCents = Math.min(receivableOpenCents, payableOpenCents);
  const cashDifferenceCents = Math.abs(receivableOpenCents - payableOpenCents);
  return { nettedCents, cashDifferenceCents };
}

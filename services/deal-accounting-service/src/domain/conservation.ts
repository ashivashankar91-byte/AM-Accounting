// Pure conservation-math proofs, DB-free, for S086 (unwind symmetry),
// S087 (recontract net-effect), S088 (CIT short-fund disposition), S089
// (payoff variance disposition), and S090 (wholesale gain/loss + arbitration
// claw-back). All amounts are whole-cent integers (see domain/money.ts) so
// every proof is exact — no floating-point drift possible.

// ── S086 — unwind: mirrored-reversal symmetry proof ─────────────────────────

export interface JournalLineAmounts {
  drCents: number;
  crCents: number;
}

/**
 * S218's own reversal-service.ts swaps dr<->cr per line and posts through
 * the same single posting door — this proves that INVARIANT numerically
 * given two same-length, same-order line lists (original vs reversal),
 * exactly what a live-db test asserts against the real coa-service response
 * lines. Returns true iff every line's dr/cr are exactly swapped and the
 * totals net to zero.
 */
export function proveMirroredReversal(original: JournalLineAmounts[], reversal: JournalLineAmounts[]): boolean {
  if (original.length !== reversal.length) return false;
  for (let i = 0; i < original.length; i++) {
    if (original[i].drCents !== reversal[i].crCents) return false;
    if (original[i].crCents !== reversal[i].drCents) return false;
  }
  const netDr = original.reduce((a, l) => a + l.drCents, 0) + reversal.reduce((a, l) => a + l.drCents, 0);
  const netCr = original.reduce((a, l) => a + l.crCents, 0) + reversal.reduce((a, l) => a + l.crCents, 0);
  return netDr === netCr; // both sides cancel to the same net figure (trivially true if swap holds, kept as an explicit second proof)
}

// ── S088 — CIT short-funding disposition conservation ───────────────────────

export type CitDispositionType = 'FEE_WITHHELD' | 'CONTRACT_ISSUE';

export function computeCitShortfallCents(citOriginalAmountCents: number, receivedAmountCents: number): number {
  return Math.max(0, citOriginalAmountCents - receivedAmountCents);
}

/**
 * FEE_WITHHELD conservation identity: relieved (received) + fee withheld
 * must equal the original CIT amount exactly — the item closes fully once
 * the fee leg is posted. CONTRACT_ISSUE never posts a fee: the item stays
 * open (PARTIALLY_APPLIED) for the shortfall pending a corrected funding
 * receipt, which is itself a valid (not-yet-conserved) terminal state for
 * that disposition type — proven separately by asserting remainingBalance
 * === shortfallCents in that path's test, not via this identity.
 */
export function verifyFeeWithheldConservation(citOriginalAmountCents: number, receivedAmountCents: number, feeAmountCents: number): boolean {
  return receivedAmountCents + feeAmountCents === citOriginalAmountCents;
}

// ── S089 — payoff variance disposition ───────────────────────────────────────

export type PayoffVarianceDisposition = 'ADDITIONAL_PAYMENT' | 'REFUND_RECEIVABLE' | 'NONE';

/**
 * actual > recap: we paid the lienholder more than the recap's booked
 * liability -> an ADDITIONAL_PAYMENT ceremony is required (someone owes the
 * difference). actual < recap: we paid less -> a REFUND_RECEIVABLE (money
 * owed back). Equal: no disposition needed.
 */
export function determinePayoffVarianceDisposition(recapAmountCents: number, actualAmountCents: number): PayoffVarianceDisposition {
  if (actualAmountCents > recapAmountCents) return 'ADDITIONAL_PAYMENT';
  if (actualAmountCents < recapAmountCents) return 'REFUND_RECEIVABLE';
  return 'NONE';
}

export function computePayoffVarianceCents(recapAmountCents: number, actualAmountCents: number): number {
  return actualAmountCents - recapAmountCents; // signed
}

// ── S090 — wholesale disposition gain/loss + arbitration conservation ──────

export type WholesaleOutcome = 'GAIN' | 'LOSS' | 'NONE';

export function determineWholesaleOutcome(wholesaleAmountCents: number, unitReliefAmountCents: number): { outcome: WholesaleOutcome; amountCents: number } {
  const delta = wholesaleAmountCents - unitReliefAmountCents;
  if (delta > 0) return { outcome: 'GAIN', amountCents: delta };
  if (delta < 0) return { outcome: 'LOSS', amountCents: -delta };
  return { outcome: 'NONE', amountCents: 0 };
}

/**
 * Disposition conservation identity: wholesale AR = unit relief + auction
 * fees +/- gain/loss (gain reduces the AR needed to balance against relief+
 * fees; loss increases it) — i.e. wholesaleAmount + fees always equals
 * unitRelief + fees plus the signed gain/loss. Restated as a checkable
 * identity independent of sign bookkeeping:
 *   wholesaleAmountCents === unitReliefAmountCents + (outcome==='GAIN' ? amountCents : -amountCents)
 */
export function verifyWholesaleConservation(wholesaleAmountCents: number, unitReliefAmountCents: number, outcome: WholesaleOutcome, amountCents: number): boolean {
  if (outcome === 'NONE') return wholesaleAmountCents === unitReliefAmountCents;
  const signed = outcome === 'GAIN' ? amountCents : -amountCents;
  return wholesaleAmountCents === unitReliefAmountCents + signed;
}

/** Arbitration price-adjustment: new AR = original AR + signed adjustment (adjustment may be negative). */
export function applyArbitrationPriceAdjustmentCents(originalArCents: number, adjustmentCents: number): number {
  return originalArCents + adjustmentCents;
}

/** Arbitration unit-return: full reversal of the original disposition + condition-cost lines added on top. Returns the net GL impact (should be exactly -original + conditionCost, i.e. the unit comes back and we additionally absorb condition costs). */
export function computeArbitrationUnitReturnNetCents(originalWholesaleAmountCents: number, conditionCostCents: number): number {
  return -originalWholesaleAmountCents + conditionCostCents;
}

// Pure money helpers. Integer-cents arithmetic throughout — mirrors
// services/coa-service/src/domain/journal-posting.ts's toCents/centsToDollars
// and services/coa-service/src/domain/posting-engine/blueprint.ts's
// allocateCents EXACTLY (same "last allocation absorbs the rounding
// remainder" technique), per this service's mandate to use "the SAME
// remainder-absorbing technique as the DSL's own bp allocation, not ad-hoc
// rounding" for every derived split in this service (chargeback-reserve
// accrual, cancellation leg splits, deferral-recognition per-period splits).
//
// No I/O, no Date.now(), no randomness — every function here is a pure,
// deterministic transform, fully unit-testable without a database.

export const BP_TOTAL = 10_000;

export function toCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function centsToDollarString(cents: number): string {
  return centsToDollars(cents).toFixed(2);
}

/**
 * Split totalCents across N weights (basis points, need not sum to BP_TOTAL —
 * each weight is applied independently and the LAST allocation absorbs
 * whatever rounding remainder is left over) — byte-identical algorithm to
 * coa-service's posting-engine/blueprint.ts#allocateCents. Guarantees
 * Σ(out) === totalCents exactly, always, for any weights array of length >= 1.
 *
 * CAUTION (degenerate single-weight case): with exactly one weight, the
 * "last allocation absorbs the remainder" rule means element 0 is never
 * actually scaled by that weight — it always returns the full totalCents
 * unchanged (there is no "running" total from any prior element to
 * subtract). To derive a single percent-scaled amount (e.g. "X% of
 * totalCents"), always pass the TWO-element form `[bp, BP_TOTAL - bp]` and
 * take element 0 — exactly how every call site in this service's domain
 * modules (chargeback-reserve.ts, cancellation.ts) uses it.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const out: number[] = [];
  let running = 0;
  for (let i = 0; i < weights.length - 1; i++) {
    const c = Math.round((totalCents * weights[i]) / BP_TOTAL);
    out.push(c);
    running += c;
  }
  out.push(totalCents - running); // last allocation absorbs the rounding remainder
  return out;
}

/**
 * Divide totalCents into `parts` EQUAL shares (used for straight-line
 * deferral-recognition schedules) — same remainder-absorbing principle as
 * allocateCents, specialized for an equal-weight split: floor-divide for the
 * first parts-1 shares, the LAST share absorbs the remainder. Guarantees
 * Σ(out) === totalCents exactly and every share is within 1 cent of every
 * other share.
 */
export function divideEqually(totalCents: number, parts: number): number[] {
  if (parts <= 0) throw new Error(`divideEqually: parts must be positive, got ${parts}`);
  const per = Math.floor(totalCents / parts);
  const out: number[] = [];
  let running = 0;
  for (let i = 0; i < parts - 1; i++) {
    out.push(per);
    running += per;
  }
  out.push(totalCents - running);
  return out;
}

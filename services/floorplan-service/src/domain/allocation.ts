// CE-12 (S082) — deterministic basis-point allocation with exact-sum
// (remainder-absorbing) rounding. Same technique the coa-service posting
// DSL uses for a posting group's debit/credit allocations (bp sums to
// exactly BP_TOTAL), reused here for splitting an ENTERED interest
// statement figure across units/departments (S082 AC: "interest
// allocation's sum across units/departments equals the entered statement
// figure exactly"). All arithmetic is integer-cents to respect the
// NUMERIC(15,2) money discipline — never floating point.
import { FloorplanValidationError } from './errors';

export const BP_TOTAL = 10_000;

export interface AllocationWeight {
  key: string;
  bp: number;
}

export interface AllocationResult {
  key: string;
  bp: number;
  amount: string;
}

function toCents(amount: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new FloorplanValidationError(`Invalid decimal amount: ${amount}`);
  // Round to avoid binary floating point artifacts (e.g. 10.005 -> 1000.4999...).
  return Math.round(n * 100);
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${dollars}.${String(rem).padStart(2, '0')}`;
}

/**
 * Splits totalAmount across `weights` in proportion to each weight's `bp`
 * (basis points, must sum to exactly BP_TOTAL=10000). Uses the largest-
 * remainder method on integer cents so the returned amounts ALWAYS sum to
 * exactly totalAmount to the cent, regardless of rounding — the same
 * guarantee coa-service's posting DSL blueprint verifier enforces for a
 * posting group's own bp-split allocations.
 */
export function splitByBasisPoints(totalAmount: string, weights: AllocationWeight[]): AllocationResult[] {
  if (weights.length === 0) {
    throw new FloorplanValidationError('splitByBasisPoints requires at least one weight.');
  }
  const bpSum = weights.reduce((s, w) => s + w.bp, 0);
  if (bpSum !== BP_TOTAL) {
    throw new FloorplanValidationError(`Allocation weights must sum to exactly ${BP_TOTAL}bp (got ${bpSum}bp).`);
  }
  if (weights.some((w) => w.bp <= 0)) {
    throw new FloorplanValidationError('Every allocation weight must have bp > 0.');
  }

  const totalCents = toCents(totalAmount);
  const negative = totalCents < 0;
  const absCents = Math.abs(totalCents);

  const raw = weights.map((w) => {
    const exact = (absCents * w.bp) / BP_TOTAL;
    const floor = Math.floor(exact);
    return { key: w.key, bp: w.bp, floor, remainder: exact - floor };
  });

  const allocatedSoFar = raw.reduce((s, r) => s + r.floor, 0);
  let centsToDistribute = absCents - allocatedSoFar;

  // Largest-remainder-first, tie-broken by weight order (stable sort) so the
  // distribution is fully deterministic for identical inputs.
  const order = raw
    .map((r, idx) => ({ ...r, idx }))
    .sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);

  const finalCents = new Map<number, number>();
  raw.forEach((r, idx) => finalCents.set(idx, r.floor));
  for (let i = 0; i < order.length && centsToDistribute > 0; i++, centsToDistribute--) {
    const idx = order[i].idx;
    finalCents.set(idx, (finalCents.get(idx) ?? 0) + 1);
  }

  return raw.map((r, idx) => {
    const cents = (finalCents.get(idx) ?? 0) * (negative ? -1 : 1);
    return { key: r.key, bp: r.bp, amount: fromCents(cents) };
  });
}

/** PER_UNIT_EQUAL basis: splits `keys` into equal bp shares (remainder bp
 * distributed to the first keys), then delegates to splitByBasisPoints. */
export function splitEqual(totalAmount: string, keys: string[]): AllocationResult[] {
  if (keys.length === 0) {
    throw new FloorplanValidationError('splitEqual requires at least one key.');
  }
  const base = Math.floor(BP_TOTAL / keys.length);
  let remainder = BP_TOTAL - base * keys.length;
  const weights: AllocationWeight[] = keys.map((key) => {
    const bp = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    return { key, bp };
  });
  return splitByBasisPoints(totalAmount, weights);
}

/** PER_UNIT_BALANCE_WEIGHTED basis: splits proportionally to each key's
 * `balance` (e.g. each unit's remaining floorplan liability), converting
 * balances to bp before delegating to splitByBasisPoints. Falls back to
 * splitEqual if every balance is zero (nothing to weight by). */
export function splitBalanceWeighted(totalAmount: string, balances: { key: string; balance: string }[]): AllocationResult[] {
  if (balances.length === 0) {
    throw new FloorplanValidationError('splitBalanceWeighted requires at least one balance.');
  }
  const balanceCents = balances.map((b) => ({ key: b.key, cents: toCents(b.balance) }));
  const totalBalanceCents = balanceCents.reduce((s, b) => s + Math.max(0, b.cents), 0);
  if (totalBalanceCents === 0) {
    return splitEqual(totalAmount, balances.map((b) => b.key));
  }

  const raw = balanceCents.map((b) => {
    const exact = (Math.max(0, b.cents) * BP_TOTAL) / totalBalanceCents;
    return { key: b.key, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let allocatedBp = raw.reduce((s, r) => s + r.floor, 0);
  let bpToDistribute = BP_TOTAL - allocatedBp;
  const order = raw.map((r, idx) => ({ ...r, idx })).sort((a, b) => b.remainder - a.remainder || a.idx - b.idx);
  const finalBp = new Map<number, number>();
  raw.forEach((r, idx) => finalBp.set(idx, r.floor));
  for (let i = 0; i < order.length && bpToDistribute > 0; i++, bpToDistribute--) {
    const idx = order[i].idx;
    finalBp.set(idx, (finalBp.get(idx) ?? 0) + 1);
  }
  const weights: AllocationWeight[] = raw.map((r, idx) => ({ key: r.key, bp: finalBp.get(idx) ?? 0 })).filter((w) => w.bp > 0);
  // Extremely unlikely (only if a key rounds to 0bp) — re-run splitEqual if
  // rounding eliminated a key entirely, rather than silently dropping it.
  if (weights.length !== balances.length) {
    return splitEqual(totalAmount, balances.map((b) => b.key));
  }
  return splitByBasisPoints(totalAmount, weights);
}

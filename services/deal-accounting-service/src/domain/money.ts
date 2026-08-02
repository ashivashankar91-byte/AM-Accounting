// Cents-safe decimal helpers — mirrors services/coa-service/src/domain/
// journal-posting.ts's toCents/centsToDollars exactly, so every conservation
// proof in this service (S086 unwind symmetry, S087 delta math, S088
// short-fund conservation, S089 payoff variance, S090 wholesale gain/loss)
// is computed the identical way coa-service's own posting engine computes
// its blueprint amounts — no independent (and possibly divergent) rounding
// rule is invented here.
//
// NUMERIC(15,2) everywhere — this module is the only place cents<->dollars
// conversion happens; every other file works in either whole-cent integers
// or string/Decimal dollar amounts, never raw floating point arithmetic on
// dollars.

export function toCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Formats a whole-cent integer as a fixed 2-decimal string, e.g. -150 -> "-1.50". Safe for Prisma Decimal input. */
export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${dollars}.${String(rem).padStart(2, '0')}`;
}

export function isPositiveDecimalString(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim() === '') return false;
  const cents = toCents(v);
  return Number.isFinite(cents) && cents > 0;
}

export function isNonNegativeDecimalString(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim() === '') return false;
  const cents = toCents(v);
  return Number.isFinite(cents) && cents >= 0;
}

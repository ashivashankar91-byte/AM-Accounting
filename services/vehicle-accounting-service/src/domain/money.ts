// Cents-based decimal-safe money helpers — same convention as coa-service's
// domain/journal-posting.ts (toCents/centsToDollars) so this service's
// dollar math never drifts from the posting engine's own rounding rule.
// CLAUDE.md rule #1: NUMERIC(15,2) for ALL money, never Float/Double in
// persistence — these helpers operate on integer cents in memory precisely
// so no floating-point summation ever touches a dollar figure directly.

export function toCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Formats cents as a fixed 2-decimal dollar string, the shape every event payload dollar field uses. */
export function centsToDollarString(cents: number): string {
  return centsToDollars(cents).toFixed(2);
}

export class InvalidAmountError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_AMOUNT';
  constructor(field: string, value: unknown) {
    super(`${field} is not a valid non-negative decimal amount: ${JSON.stringify(value)}`);
    this.name = 'InvalidAmountError';
  }
}

/** Parses a dollar string/number into cents, throwing on NaN/negative — the guard every cost-component input goes through before it's trusted. */
export function requireNonNegativeCents(field: string, value: number | string): number {
  const cents = toCents(value);
  if (Number.isNaN(cents) || cents < 0) throw new InvalidAmountError(field, value);
  return cents;
}

export function requirePositiveCents(field: string, value: number | string): number {
  const cents = toCents(value);
  if (Number.isNaN(cents) || cents <= 0) throw new InvalidAmountError(field, value);
  return cents;
}

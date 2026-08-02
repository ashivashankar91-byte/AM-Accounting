// Deterministic cents-integer money math — mirrors
// services/coa-service/src/domain/journal-posting.ts's toCents/centsToDollars.
// Never do monetary arithmetic in floating dollars.

export function toCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  // Prisma returns Decimal columns as Decimal.js instances, not plain
  // numbers/strings — Number(v) coerces via their toString(), unlike a bare
  // typeof-number check which left Decimal instances as NaN.
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function sumCents(values: Array<number | string | null | undefined>): number {
  return values.reduce((acc: number, v) => acc + toCents(v), 0);
}

/** D-19 rounding: conservation is proven in integer cents, never floats. */
export class ConservationViolationError extends Error {
  constructor(expectedCents: number, actualCents: number, context: string) {
    super(
      `Conservation violated (${context}): expected ${centsToDollars(expectedCents)}, ` +
      `got ${centsToDollars(actualCents)} (delta ${centsToDollars(actualCents - expectedCents)} cents-adjusted)`,
    );
    this.name = 'ConservationViolationError';
  }
}

export function assertConserves(expected: number | string, actualParts: Array<number | string | null | undefined>, context: string): void {
  const expectedCents = toCents(expected);
  const actualCents = sumCents(actualParts);
  if (expectedCents !== actualCents) {
    throw new ConservationViolationError(expectedCents, actualCents, context);
  }
}

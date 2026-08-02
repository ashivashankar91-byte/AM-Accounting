// Deterministic cents-integer money math — mirrors
// services/coa-service/src/domain/journal-posting.ts's toCents/centsToDollars
// exactly (same rounding rule) so DR=CR reconciles to the cent across
// services. Never do arithmetic in JS float on dollar values directly.

// Accepts plain numbers/strings as well as Prisma's generated Decimal type
// (duck-typed via toString() so this module never imports the
// service-specific generated Prisma client).
type MoneyLike = number | string | { toString(): string } | null | undefined;

export function toCents(v: MoneyLike): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v.toString());
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function addCents(...values: MoneyLike[]): number {
  return values.reduce<number>((sum, v) => sum + toCents(v), 0);
}

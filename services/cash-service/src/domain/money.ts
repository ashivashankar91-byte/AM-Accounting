// S052 — integer-cents money helpers. Identical convention to
// coa-service/src/domain/journal-posting.ts (toCents/centsToDollars): all
// arithmetic happens in integer cents to avoid binary-float drift; DB
// columns are NUMERIC(15,2) per CLAUDE.md's non-negotiable money rule.

export function toCents(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

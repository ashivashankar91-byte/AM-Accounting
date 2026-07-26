// S213 — Journal Numbering Sequences: number formatting + validation.
// Format {SOURCE}-{YYYY-MM}-{seq:06d} is INTERIM per UQ-12/19.

export const PERIOD_CODE_RE = /^[0-9]{4}-[0-9]{2}$/;
export const SOURCE_CODE_RE = /^[A-Z0-9]{2,6}$/;

export function isValidPeriodCode(v: unknown): v is string {
  return typeof v === 'string' && PERIOD_CODE_RE.test(v);
}

export function isValidSourceCode(v: unknown): v is string {
  return typeof v === 'string' && SOURCE_CODE_RE.test(v);
}

/** {SOURCE}-{YYYY-MM}-{seq:06d} — interim scheme (UQ-12/19). */
export function formatJournalNumber(sourceCode: string, periodCode: string, seq: number): string {
  return `${sourceCode}-${periodCode}-${String(seq).padStart(6, '0')}`;
}

/**
 * CE-16 — Sensitive-data masking.
 *
 * Legacy extracts routinely carry SSNs, bank account numbers, driver-license
 * numbers and card PANs in free-form columns. Those values must survive
 * transformation (they are part of the record's identity for reconciliation)
 * but must never be rendered to an operator who lacks
 * `migration.sensitive.view`, and must never appear in exception evidence,
 * lineage evidence, logs or API payloads for such an operator.
 *
 * Pure module — no I/O, no clock reads.
 */

const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
  /ssn/i,
  /social.?security/i,
  /tax.?id/i,
  /\bein\b/i,
  /bank.?account/i,
  /account.?number/i,
  /routing/i,
  /iban/i,
  /card.?number/i,
  /\bpan\b/i,
  /driver.?licen[cs]e/i,
  /\bdl.?number\b/i,
  /passport/i,
  /date.?of.?birth/i,
  /\bdob\b/i,
];

export function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((re) => re.test(fieldName));
}

/** Retains the last 4 characters so a human can still recognise the record. */
export function maskValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (raw.length <= 4) return '*'.repeat(raw.length);
  return `${'*'.repeat(Math.max(raw.length - 4, 4))}${raw.slice(-4)}`;
}

export interface MaskOptions {
  /** True only when the caller holds `migration.sensitive.view`. */
  allowSensitive: boolean;
}

export function maskRecord<T extends Record<string, unknown>>(record: T, options: MaskOptions): Record<string, unknown> {
  if (options.allowSensitive) return { ...record };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isSensitiveField(key)) {
      out[key] = maskValue(value);
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = maskRecord(value as Record<string, unknown>, options);
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.map((v) =>
        v && typeof v === 'object' ? maskRecord(v as Record<string, unknown>, options) : v,
      );
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function maskRecords(records: Record<string, unknown>[], options: MaskOptions): Record<string, unknown>[] {
  return records.map((r) => maskRecord(r, options));
}

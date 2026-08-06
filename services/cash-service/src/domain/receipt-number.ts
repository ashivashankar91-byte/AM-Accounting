// S052 — receipt numbering format. Scoped per (tenant, store, businessDate)
// — see application/receipt-sequence-service.ts for the atomic allocator,
// which mirrors coa-service's JournalSequence INSERT..ON CONFLICT pattern
// exactly (see that file's header comment for why: a separate
// findUnique->create->update sequence aborts the whole transaction for
// every losing concurrent caller).

export const BUSINESS_DATE_COMPACT_RE = /^\d{8}$/;
export const STORE_CODE_RE = /^[A-Z0-9-]{1,20}$/;

export function isValidStoreCode(v: unknown): v is string {
  return typeof v === 'string' && STORE_CODE_RE.test(v);
}

export function toCompactDate(businessDate: string): string {
  return businessDate.replace(/-/g, '');
}

/** {CR}-{STORE}-{YYYYMMDD}-{seq:04d} */
export function formatReceiptNumber(storeCode: string, businessDate: string, seq: number): string {
  return `CR-${storeCode}-${toCompactDate(businessDate)}-${String(seq).padStart(4, '0')}`;
}

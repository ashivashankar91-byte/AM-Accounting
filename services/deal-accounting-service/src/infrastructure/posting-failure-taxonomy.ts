// Mirrors services/posting-recovery-service/src/domain/taxonomy.ts's
// POSTING_FAILURE_CATEGORIES verbatim — this service's REJECTED/FAILED
// dead-letter filings must use one of these stable category values.

export const POSTING_FAILURE_CATEGORIES = [
  'EVENT_CONTRACT_INVALID',
  'RULE_NOT_FOUND',
  'RULE_CONFIGURATION_INVALID',
  'ACCOUNTING_MAPPING_UNRESOLVED',
  'REFERENCE_DATA_MISSING',
  'ACCOUNTING_PERIOD_BLOCKED',
  'SOURCE_STATE_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'AUTHORIZATION_FAILURE',
  'DOWNSTREAM_TRANSIENT',
  'DOWNSTREAM_PERMANENT',
  'INFRASTRUCTURE_FAILURE',
  'UNKNOWN_FAILURE',
] as const;

export type PostingFailureCategory = (typeof POSTING_FAILURE_CATEGORIES)[number];

/** Best-effort classification of a coa-service failureReason string into a
 * stable category — coa-service does not return a machine-readable category
 * itself (see services/coa-service/src/application/posting-engine-service.ts
 * finalizeRejected/finalizeFailed), only a free-text failureReason. */
export function classifyCoaFailureReason(reason: string | null | undefined): PostingFailureCategory {
  const r = (reason ?? '').toLowerCase();
  if (r.includes('could not be resolved') || r.includes('account_mapping_values_pending') || r.includes('account ')) return 'ACCOUNTING_MAPPING_UNRESOLVED';
  if (r.includes('no active rule pack') || r.includes('no rule condition matched')) return 'RULE_NOT_FOUND';
  if (r.includes('period') && (r.includes('closed') || r.includes('not open'))) return 'ACCOUNTING_PERIOD_BLOCKED';
  if (r.includes('required value missing') || r.includes('resolved to no value')) return 'REFERENCE_DATA_MISSING';
  if (r.includes('identity conflict')) return 'IDEMPOTENCY_CONFLICT';
  if (r.includes('unreachable') || r.includes('http 5')) return 'DOWNSTREAM_TRANSIENT';
  return 'UNKNOWN_FAILURE';
}

// S021 — stable posting-failure taxonomy. Categories are broad and stable;
// failureCode (free-form but conventionally SCREAMING_SNAKE_CASE) is a
// separate, more specific stable identifier stored alongside the category
// on every PostingDeadLetterFailure row. No automatic replay policy is
// attached to any category in this slice.

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

const CATEGORY_SET: ReadonlySet<string> = new Set(POSTING_FAILURE_CATEGORIES);

export function isPostingFailureCategory(value: string): value is PostingFailureCategory {
  return CATEGORY_SET.has(value);
}

export const POSTING_FAILURE_STAGES = [
  'CONTRACT_VALIDATION',
  'RULE_RESOLUTION',
  'MAPPING',
  'PERIOD_CHECK',
  'DOWNSTREAM_POST',
  'UNKNOWN',
] as const;

export type PostingFailureStage = (typeof POSTING_FAILURE_STAGES)[number];

const STAGE_SET: ReadonlySet<string> = new Set(POSTING_FAILURE_STAGES);

export function isPostingFailureStage(value: string): value is PostingFailureStage {
  return STAGE_SET.has(value);
}

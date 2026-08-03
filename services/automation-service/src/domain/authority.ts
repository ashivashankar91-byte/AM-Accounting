/**
 * CE-17 — Authority ladder and truthful states.
 *
 * Authority is a ladder, not a flag. A capability climbs it one rung at a
 * time, each rung granted by one identity and activated by another, and it can
 * be knocked off it entirely (SUSPENDED) at any moment. Nothing here defaults
 * to anything except OBSERVE_ONLY.
 */

export const AUTHORITY_LEVELS = [
  'OBSERVE_ONLY',
  'RECOMMEND',
  'PREPARE_DRAFT',
  'EXECUTE_WITH_APPROVAL',
  'AUTO_EXECUTE_WITHIN_POLICY',
  'SUSPENDED',
] as const;

export type AuthorityLevel = (typeof AUTHORITY_LEVELS)[number];

/** Ordered rungs. SUSPENDED is off-ladder — it is a state, not a promotion. */
export const AUTHORITY_LADDER: AuthorityLevel[] = [
  'OBSERVE_ONLY',
  'RECOMMEND',
  'PREPARE_DRAFT',
  'EXECUTE_WITH_APPROVAL',
  'AUTO_EXECUTE_WITHIN_POLICY',
];

export const DEFAULT_AUTHORITY: AuthorityLevel = 'OBSERVE_ONLY';

export function authorityRank(level: string): number {
  const idx = AUTHORITY_LADDER.indexOf(level as AuthorityLevel);
  return idx < 0 ? -1 : idx;
}

export function isAuthorityLevel(value: string): value is AuthorityLevel {
  return (AUTHORITY_LEVELS as readonly string[]).includes(value);
}

/** True when `level` is at least as high as `required` on the ladder. */
export function authorityAtLeast(level: string, required: AuthorityLevel): boolean {
  if (level === 'SUSPENDED') return false;
  return authorityRank(level) >= authorityRank(required);
}

// ── Truthful states ──────────────────────────────────────────────────────────

export const TRUTHFUL_STATES = [
  'NOT_CONFIGURED',
  'OBSERVATION_ONLY',
  'RECOMMENDATION_READY',
  'APPROVAL_REQUIRED',
  'EXECUTION_PENDING',
  'EXECUTED',
  'FAILED_CLOSED',
  'SUSPENDED',
  'MODEL_OR_RULE_UNAVAILABLE',
] as const;

export type TruthfulState = (typeof TRUTHFUL_STATES)[number];

export function isTruthfulState(value: string): value is TruthfulState {
  return (TRUTHFUL_STATES as readonly string[]).includes(value);
}

/**
 * Permitted item transitions. EXECUTED is terminal for the item itself — a
 * later correction or reversal is a *new* item that points back at this one,
 * never an edit of the executed record.
 */
export const ITEM_TRANSITIONS: Record<TruthfulState, TruthfulState[]> = {
  NOT_CONFIGURED: ['OBSERVATION_ONLY', 'SUSPENDED'],
  OBSERVATION_ONLY: ['RECOMMENDATION_READY', 'SUSPENDED', 'MODEL_OR_RULE_UNAVAILABLE'],
  RECOMMENDATION_READY: ['APPROVAL_REQUIRED', 'EXECUTION_PENDING', 'FAILED_CLOSED', 'SUSPENDED', 'MODEL_OR_RULE_UNAVAILABLE'],
  APPROVAL_REQUIRED: ['EXECUTION_PENDING', 'FAILED_CLOSED', 'SUSPENDED'],
  EXECUTION_PENDING: ['EXECUTED', 'FAILED_CLOSED', 'SUSPENDED'],
  EXECUTED: [],
  FAILED_CLOSED: ['EXECUTION_PENDING', 'APPROVAL_REQUIRED', 'SUSPENDED'],
  SUSPENDED: ['RECOMMENDATION_READY', 'APPROVAL_REQUIRED', 'FAILED_CLOSED'],
  MODEL_OR_RULE_UNAVAILABLE: ['RECOMMENDATION_READY', 'OBSERVATION_ONLY', 'SUSPENDED'],
};

export function canTransition(from: string, to: string): boolean {
  if (!isTruthfulState(from) || !isTruthfulState(to)) return false;
  return ITEM_TRANSITIONS[from].includes(to);
}

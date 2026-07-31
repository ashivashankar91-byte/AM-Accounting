// S021 — posting-recovery case lifecycle state machine.

export const CASE_STATUSES = [
  'QUARANTINED',
  'UNDER_REVIEW',
  'AWAITING_CORRECTION',
  'READY_FOR_REPLAY',
  'REPLAY_IN_PROGRESS',
  'RESOLVED',
  'ESCALATED',
  'DISPOSITIONED',
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];

const CASE_STATUS_SET: ReadonlySet<string> = new Set(CASE_STATUSES);

export function isCaseStatus(value: string): value is CaseStatus {
  return CASE_STATUS_SET.has(value);
}

// RESOLVED and DISPOSITIONED are terminal: no route or fixture may move a
// case out of them. ESCALATED is not terminal — an escalated case can still
// be worked (routed back to review) or ultimately dispositioned.
const TERMINAL_STATUSES: ReadonlySet<CaseStatus> = new Set(['RESOLVED', 'DISPOSITIONED']);

const ALLOWED_TRANSITIONS: Record<CaseStatus, readonly CaseStatus[]> = {
  QUARANTINED: ['UNDER_REVIEW', 'ESCALATED', 'DISPOSITIONED'],
  UNDER_REVIEW: ['AWAITING_CORRECTION', 'READY_FOR_REPLAY', 'ESCALATED', 'DISPOSITIONED', 'QUARANTINED'],
  AWAITING_CORRECTION: ['UNDER_REVIEW', 'READY_FOR_REPLAY', 'ESCALATED', 'DISPOSITIONED'],
  READY_FOR_REPLAY: ['REPLAY_IN_PROGRESS', 'AWAITING_CORRECTION', 'ESCALATED', 'DISPOSITIONED'],
  REPLAY_IN_PROGRESS: ['RESOLVED', 'AWAITING_CORRECTION', 'UNDER_REVIEW', 'ESCALATED'],
  RESOLVED: [],
  ESCALATED: ['UNDER_REVIEW', 'DISPOSITIONED'],
  DISPOSITIONED: [],
};

export class InvalidCaseTransitionError extends Error {
  code = 'INVALID_CASE_TRANSITION';
  constructor(
    public readonly from: CaseStatus,
    public readonly to: CaseStatus,
  ) {
    super(`Cannot transition posting-recovery case from ${from} to ${to}`);
    this.name = 'InvalidCaseTransitionError';
  }
}

export function isTerminalStatus(status: CaseStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function assertValidTransition(from: CaseStatus, to: CaseStatus): void {
  if (from === to) {
    throw new InvalidCaseTransitionError(from, to);
  }
  if (TERMINAL_STATUSES.has(from)) {
    throw new InvalidCaseTransitionError(from, to);
  }
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new InvalidCaseTransitionError(from, to);
  }
}

// ── Replay-attempt status model ─────────────────────────────────────────────
// Real replay execution is out of scope for this slice; this model exists so
// the append-only attempt-history read contract (and its fixtures) has a
// stable, validated status vocabulary.

export const REPLAY_ATTEMPT_STATUSES = [
  'REQUESTED',
  'AUTHORIZED',
  'STARTED',
  'SUCCEEDED',
  'FAILED',
  'NOOP_ALREADY_POSTED',
  'REJECTED',
  'TIMED_OUT',
] as const;

export type ReplayAttemptStatus = (typeof REPLAY_ATTEMPT_STATUSES)[number];

const REPLAY_ATTEMPT_STATUS_SET: ReadonlySet<string> = new Set(REPLAY_ATTEMPT_STATUSES);

export function isReplayAttemptStatus(value: string): value is ReplayAttemptStatus {
  return REPLAY_ATTEMPT_STATUS_SET.has(value);
}

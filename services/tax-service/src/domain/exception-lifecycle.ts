// CE-10 / S124 — tax exception queue lifecycle state machine, mirroring
// posting-recovery-service's src/domain/lifecycle.ts state-machine style.
//
// PARKED -> RE_REQUEST_IN_PROGRESS -> RESOLVED (success), or back to PARKED
// (re-request failed again, still parked with an updated reason). RESOLVED
// is terminal.

export const EXCEPTION_STATUSES = ['PARKED', 'RE_REQUEST_IN_PROGRESS', 'RESOLVED'] as const;

export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

const EXCEPTION_STATUS_SET: ReadonlySet<string> = new Set(EXCEPTION_STATUSES);

export function isExceptionStatus(value: string): value is ExceptionStatus {
  return EXCEPTION_STATUS_SET.has(value);
}

const TERMINAL_STATUSES: ReadonlySet<ExceptionStatus> = new Set(['RESOLVED']);

const ALLOWED_TRANSITIONS: Record<ExceptionStatus, readonly ExceptionStatus[]> = {
  PARKED: ['RE_REQUEST_IN_PROGRESS'],
  RE_REQUEST_IN_PROGRESS: ['RESOLVED', 'PARKED'],
  RESOLVED: [],
};

export class InvalidExceptionTransitionError extends Error {
  code = 'INVALID_EXCEPTION_TRANSITION';
  constructor(
    public readonly from: ExceptionStatus,
    public readonly to: ExceptionStatus,
  ) {
    super(`Cannot transition tax exception from ${from} to ${to}`);
    this.name = 'InvalidExceptionTransitionError';
  }
}

export function isTerminalStatus(status: ExceptionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function assertValidTransition(from: ExceptionStatus, to: ExceptionStatus): void {
  if (from === to) throw new InvalidExceptionTransitionError(from, to);
  if (TERMINAL_STATUSES.has(from)) throw new InvalidExceptionTransitionError(from, to);
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) throw new InvalidExceptionTransitionError(from, to);
}

/** Reason codes a tax exception may be parked under. Only NOT_CONFIGURED,
 * ENGINE_UNAVAILABLE and ENGINE_REJECTED come from the S124 adapter
 * contract; ACCOUNT_MAPPING_PENDING is the S023-boundary rejection. */
export const EXCEPTION_REASON_CODES = [
  'ENGINE_UNAVAILABLE',
  'ENGINE_REJECTED',
  'NOT_CONFIGURED',
  'ACCOUNT_MAPPING_PENDING',
] as const;

export type ExceptionReasonCode = (typeof EXCEPTION_REASON_CODES)[number];

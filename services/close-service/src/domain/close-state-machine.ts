/**
 * CE-15 Close State Machine
 *
 * Authoritative transitions per (tenant × legalEntityId × period).
 * States: NOT_READY | READY_WITH_EXCEPTIONS | READY | PRELIMINARY_CLOSED | FINAL_CLOSED
 * Side states: REOPEN_PENDING_APPROVAL | STATUTORY_SOURCE_UNAVAILABLE
 *
 * Package rule: preliminary close ≠ final close ≠ operational completion.
 * SoD rule: no identity may override exception AND grant final close for same period.
 */

export enum CloseState {
  NOT_READY = 'NOT_READY',
  READY_WITH_EXCEPTIONS = 'READY_WITH_EXCEPTIONS',
  READY = 'READY',
  PRELIMINARY_CLOSED = 'PRELIMINARY_CLOSED',
  FINAL_CLOSED = 'FINAL_CLOSED',
  REOPEN_PENDING_APPROVAL = 'REOPEN_PENDING_APPROVAL',
  STATUTORY_SOURCE_UNAVAILABLE = 'STATUTORY_SOURCE_UNAVAILABLE',
}

// Alias for code that uses CLOSE_STATES.XXX pattern
export const CLOSE_STATES = CloseState;

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly from: CloseState,
    public readonly to: CloseState,
    public readonly code = 'INVALID_TRANSITION',
  ) {
    super(`Invalid transition from ${from} to ${to}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class SoDViolationError extends Error {
  constructor(message: string, public readonly code = 'SOD_VIOLATION') {
    super(message);
    this.name = 'SoDViolationError';
  }
}

// Keep for backward compat with domain code
export { InvalidStateTransitionError as CloseStateMachineError };

const VALID_TRANSITIONS: Partial<Record<CloseState, CloseState[]>> = {
  [CloseState.NOT_READY]: [
    CloseState.READY_WITH_EXCEPTIONS,
    CloseState.READY,
    CloseState.REOPEN_PENDING_APPROVAL,
  ],
  [CloseState.READY_WITH_EXCEPTIONS]: [
    CloseState.READY,
    CloseState.NOT_READY,
    CloseState.PRELIMINARY_CLOSED,
    CloseState.REOPEN_PENDING_APPROVAL,
  ],
  [CloseState.READY]: [
    CloseState.PRELIMINARY_CLOSED,
    CloseState.READY_WITH_EXCEPTIONS,
    CloseState.NOT_READY,
    CloseState.REOPEN_PENDING_APPROVAL,
  ],
  [CloseState.PRELIMINARY_CLOSED]: [
    CloseState.FINAL_CLOSED,
    CloseState.REOPEN_PENDING_APPROVAL,
  ],
  [CloseState.FINAL_CLOSED]: [
    CloseState.REOPEN_PENDING_APPROVAL,
  ],
  [CloseState.REOPEN_PENDING_APPROVAL]: [
    CloseState.READY,
    CloseState.PRELIMINARY_CLOSED,
    CloseState.NOT_READY,
  ],
  [CloseState.STATUTORY_SOURCE_UNAVAILABLE]: [
    CloseState.NOT_READY,
    CloseState.REOPEN_PENDING_APPROVAL,
  ],
};

export function isValidTransition(from: CloseState, to: CloseState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Alias used by some domain code */
export function assertTransitionAllowed(from: CloseState, to: CloseState): void {
  if (!isValidTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
}

export function applyTransition(
  current: CloseState,
  requested: CloseState,
  actor: string,
  context: { overriderIds?: string[]; requiresSoDCheck?: boolean },
): CloseState {
  assertTransitionAllowed(current, requested);
  if (
    context.requiresSoDCheck &&
    requested === CloseState.FINAL_CLOSED &&
    context.overriderIds?.includes(actor)
  ) {
    throw new SoDViolationError(
      `Actor ${actor} cannot grant final close after overriding exceptions for this period`,
      'FINAL_CLOSE_SOD_EXCEPTION_OVERRIDE',
    );
  }
  return requested;
}

export interface UpstreamModuleSignal {
  moduleCode: string;
  status: 'READY' | 'NOT_READY' | 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION';
}

export interface ReadinessInput {
  allMandatoryTasksVerified: boolean;
  hasUnreconciled: boolean;
  hasOpenExceptions: boolean;
  upstreamSignals: UpstreamModuleSignal[];
}

export function computeReadinessState(input: ReadinessInput): CloseState {
  if (!input.allMandatoryTasksVerified) return CloseState.NOT_READY;
  if (input.hasUnreconciled) return CloseState.NOT_READY;
  if (input.hasOpenExceptions) return CloseState.READY_WITH_EXCEPTIONS;
  return CloseState.READY;
}

import { describe, it, expect } from 'vitest';
import {
  assertValidTransition,
  InvalidCaseTransitionError,
  isCaseStatus,
  isTerminalStatus,
  isReplayAttemptStatus,
  CASE_STATUSES,
} from '../src/domain/lifecycle';

describe('posting-recovery lifecycle', () => {
  it('accepts every documented valid transition', () => {
    expect(() => assertValidTransition('QUARANTINED', 'UNDER_REVIEW')).not.toThrow();
    expect(() => assertValidTransition('UNDER_REVIEW', 'AWAITING_CORRECTION')).not.toThrow();
    expect(() => assertValidTransition('UNDER_REVIEW', 'READY_FOR_REPLAY')).not.toThrow();
    expect(() => assertValidTransition('AWAITING_CORRECTION', 'READY_FOR_REPLAY')).not.toThrow();
    expect(() => assertValidTransition('READY_FOR_REPLAY', 'REPLAY_IN_PROGRESS')).not.toThrow();
    expect(() => assertValidTransition('REPLAY_IN_PROGRESS', 'RESOLVED')).not.toThrow();
    expect(() => assertValidTransition('QUARANTINED', 'ESCALATED')).not.toThrow();
    expect(() => assertValidTransition('ESCALATED', 'UNDER_REVIEW')).not.toThrow();
    expect(() => assertValidTransition('ESCALATED', 'DISPOSITIONED')).not.toThrow();
  });

  it('rejects an invalid transition (skipping states)', () => {
    expect(() => assertValidTransition('QUARANTINED', 'RESOLVED')).toThrow(InvalidCaseTransitionError);
    expect(() => assertValidTransition('QUARANTINED', 'READY_FOR_REPLAY')).toThrow(InvalidCaseTransitionError);
  });

  it('rejects a no-op transition to the same status', () => {
    expect(() => assertValidTransition('UNDER_REVIEW', 'UNDER_REVIEW')).toThrow(InvalidCaseTransitionError);
  });

  it('terminal-state protection: RESOLVED accepts no further transition', () => {
    expect(isTerminalStatus('RESOLVED')).toBe(true);
    expect(() => assertValidTransition('RESOLVED', 'UNDER_REVIEW')).toThrow(InvalidCaseTransitionError);
    expect(() => assertValidTransition('RESOLVED', 'ESCALATED')).toThrow(InvalidCaseTransitionError);
  });

  it('terminal-state protection: DISPOSITIONED accepts no further transition', () => {
    expect(isTerminalStatus('DISPOSITIONED')).toBe(true);
    expect(() => assertValidTransition('DISPOSITIONED', 'UNDER_REVIEW')).toThrow(InvalidCaseTransitionError);
  });

  it('ESCALATED is not terminal — it can still move to UNDER_REVIEW or DISPOSITIONED', () => {
    expect(isTerminalStatus('ESCALATED')).toBe(false);
  });

  it('the error carries from/to for callers to map to a stable API error', () => {
    try {
      assertValidTransition('RESOLVED', 'UNDER_REVIEW');
      expect.unreachable();
    } catch (err: any) {
      expect(err).toBeInstanceOf(InvalidCaseTransitionError);
      expect(err.code).toBe('INVALID_CASE_TRANSITION');
      expect(err.from).toBe('RESOLVED');
      expect(err.to).toBe('UNDER_REVIEW');
    }
  });

  it('isCaseStatus / isReplayAttemptStatus validate the full enumerated set and reject unknowns', () => {
    for (const s of CASE_STATUSES) expect(isCaseStatus(s)).toBe(true);
    expect(isCaseStatus('NOT_A_STATUS')).toBe(false);
    expect(isReplayAttemptStatus('SUCCEEDED')).toBe(true);
    expect(isReplayAttemptStatus('NOT_A_STATUS')).toBe(false);
  });
});

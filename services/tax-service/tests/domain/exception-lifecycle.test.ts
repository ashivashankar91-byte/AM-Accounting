import { describe, it, expect } from 'vitest';
import { assertValidTransition, InvalidExceptionTransitionError, isTerminalStatus } from '../../src/domain/exception-lifecycle';

describe('exception-lifecycle', () => {
  it('allows PARKED -> RE_REQUEST_IN_PROGRESS', () => {
    expect(() => assertValidTransition('PARKED', 'RE_REQUEST_IN_PROGRESS')).not.toThrow();
  });

  it('allows RE_REQUEST_IN_PROGRESS -> RESOLVED', () => {
    expect(() => assertValidTransition('RE_REQUEST_IN_PROGRESS', 'RESOLVED')).not.toThrow();
  });

  it('allows RE_REQUEST_IN_PROGRESS -> PARKED (re-request still fails)', () => {
    expect(() => assertValidTransition('RE_REQUEST_IN_PROGRESS', 'PARKED')).not.toThrow();
  });

  it('rejects PARKED -> RESOLVED directly (must go through re-request)', () => {
    expect(() => assertValidTransition('PARKED', 'RESOLVED')).toThrow(InvalidExceptionTransitionError);
  });

  it('RESOLVED is terminal', () => {
    expect(isTerminalStatus('RESOLVED')).toBe(true);
    expect(() => assertValidTransition('RESOLVED', 'PARKED')).toThrow(InvalidExceptionTransitionError);
  });
});

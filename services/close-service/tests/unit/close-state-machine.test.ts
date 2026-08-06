import { describe, it, expect } from 'vitest';
import { CloseState, isValidTransition, applyTransition, InvalidStateTransitionError, SoDViolationError } from '../../src/domain/close-state-machine';

describe('close-state-machine', () => {
  it('allows NOT_READY -> READY', () => {
    expect(isValidTransition(CloseState.NOT_READY, CloseState.READY)).toBe(true);
  });

  it('allows READY -> PRELIMINARY_CLOSED', () => {
    expect(isValidTransition(CloseState.READY, CloseState.PRELIMINARY_CLOSED)).toBe(true);
  });

  it('allows PRELIMINARY_CLOSED -> FINAL_CLOSED', () => {
    expect(isValidTransition(CloseState.PRELIMINARY_CLOSED, CloseState.FINAL_CLOSED)).toBe(true);
  });

  it('rejects FINAL_CLOSED -> READY directly', () => {
    expect(isValidTransition(CloseState.FINAL_CLOSED, CloseState.READY)).toBe(false);
  });

  it('throws InvalidStateTransitionError on bad transition', () => {
    expect(() => applyTransition(CloseState.FINAL_CLOSED, CloseState.READY, 'user1', {})).toThrow(InvalidStateTransitionError);
  });

  it('throws SoDViolationError when overrider tries to final close', () => {
    expect(() => applyTransition(CloseState.PRELIMINARY_CLOSED, CloseState.FINAL_CLOSED, 'user1', {
      overriderIds: ['user1'],
      requiresSoDCheck: true,
    })).toThrow(SoDViolationError);
  });

  it('allows final close when actor did not override', () => {
    const result = applyTransition(CloseState.PRELIMINARY_CLOSED, CloseState.FINAL_CLOSED, 'user2', {
      overriderIds: ['user1'],
      requiresSoDCheck: true,
    });
    expect(result).toBe(CloseState.FINAL_CLOSED);
  });
});

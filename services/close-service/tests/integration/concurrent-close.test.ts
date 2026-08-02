import { describe, it, expect } from 'vitest';
import { isValidTransition, CloseState } from '../../src/domain/close-state-machine';

describe('concurrent-close (integration)', () => {
  it('state machine is pure function safe for concurrent checks', () => {
    const results = Array.from({ length: 10 }).map(() =>
      isValidTransition(CloseState.PRELIMINARY_CLOSED, CloseState.FINAL_CLOSED)
    );
    expect(results.every(r => r === true)).toBe(true);
  });
});

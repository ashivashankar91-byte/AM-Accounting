import { describe, it, expect } from 'vitest';
import { computeWriteDown, assertWithinThreshold, WriteDownThresholdExceededError, LcnrvValidationError } from '../../src/domain/lcnrv';

describe('lcnrv domain', () => {
  describe('computeWriteDown', () => {
    it('computes book minus market when market is lower', () => {
      const r = computeWriteDown(2_000_000, 1_800_000);
      expect(r.writeDownCents).toBe(200_000);
    });
    it('floors at 0 when market >= book (never a write-up, S076 one-way rule)', () => {
      expect(computeWriteDown(2_000_000, 2_000_000).writeDownCents).toBe(0);
      expect(computeWriteDown(2_000_000, 2_500_000).writeDownCents).toBe(0);
    });
    it('rejects a zero/negative book value or negative market value', () => {
      expect(() => computeWriteDown(0, 100)).toThrow(LcnrvValidationError);
      expect(() => computeWriteDown(1000, -1)).toThrow(LcnrvValidationError);
    });
  });

  describe('assertWithinThreshold', () => {
    it('allows a write-down at or below threshold', () => {
      expect(() => assertWithinThreshold(50_000, 50_000)).not.toThrow();
      expect(() => assertWithinThreshold(40_000, 50_000)).not.toThrow();
    });
    it('deterministically refuses above threshold — never silently caps', () => {
      expect(() => assertWithinThreshold(50_001, 50_000)).toThrow(WriteDownThresholdExceededError);
      try {
        assertWithinThreshold(50_001, 50_000);
      } catch (e: any) {
        expect(e.code).toBe('WRITE_DOWN_THRESHOLD_EXCEEDED');
        expect(e.writeDownCents).toBe(50_001);
        expect(e.thresholdCents).toBe(50_000);
      }
    });
  });
});

import { describe, it, expect } from 'vitest';
import { reclassUnitValue, computeDemoValueAdjustmentPreview, assertApprovedAmountMatchesPreview, DemoValidationError } from '../../src/domain/demo';

describe('demo domain', () => {
  describe('reclassUnitValue', () => {
    it('conserves the full current book value (S075 AC)', () => {
      expect(reclassUnitValue(2_500_000)).toBe(2_500_000);
    });
    it('rejects a zero/negative book value', () => {
      expect(() => reclassUnitValue(0)).toThrow(DemoValidationError);
      expect(() => reclassUnitValue(-100)).toThrow(DemoValidationError);
    });
  });

  describe('computeDemoValueAdjustmentPreview', () => {
    it('computes percent-of-cost-per-period mechanically', () => {
      // 2% per period, 1 period, on $10,000.00 -> $200.00
      expect(computeDemoValueAdjustmentPreview(1_000_000, 200, 1)).toBe(20_000);
    });
    it('compounds elapsed periods linearly (bp * periods), not exponentially', () => {
      expect(computeDemoValueAdjustmentPreview(1_000_000, 200, 3)).toBe(60_000);
    });
    it('never proposes writing down more than the unit is worth', () => {
      // 90% per period over 3 periods would be 270% of book value — capped at book value.
      expect(computeDemoValueAdjustmentPreview(1_000_000, 9_000, 3)).toBe(1_000_000);
    });
    it('floors sub-cent results', () => {
      // 0.01% of $0.01 = 0.000001 cents -> floors to 0
      expect(computeDemoValueAdjustmentPreview(1, 1, 1)).toBe(0);
    });
    it('rejects non-positive inputs', () => {
      expect(() => computeDemoValueAdjustmentPreview(0, 200, 1)).toThrow(DemoValidationError);
      expect(() => computeDemoValueAdjustmentPreview(1_000_000, 0, 1)).toThrow(DemoValidationError);
      expect(() => computeDemoValueAdjustmentPreview(1_000_000, 200, 0)).toThrow(DemoValidationError);
    });
  });

  describe('assertApprovedAmountMatchesPreview', () => {
    it('accepts an approved amount identical to the preview', () => {
      expect(() => assertApprovedAmountMatchesPreview(20_000, { approvedAmountCents: 20_000 })).not.toThrow();
    });
    it('rejects any deviation from the exact preview (S075 AC: adjustment = approved preview exactly)', () => {
      expect(() => assertApprovedAmountMatchesPreview(20_000, { approvedAmountCents: 19_999 })).toThrow(DemoValidationError);
      expect(() => assertApprovedAmountMatchesPreview(20_000, { approvedAmountCents: 20_001 })).toThrow(DemoValidationError);
    });
  });
});

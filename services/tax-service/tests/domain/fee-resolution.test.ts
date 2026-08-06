import { describe, it, expect } from 'vitest';
import { resolveApplicableFees, validateFeeAmountBasis, FeeTableRow } from '../../src/domain/fee-resolution';

function fee(overrides: Partial<FeeTableRow> = {}): FeeTableRow {
  return {
    id: 'fee-1',
    feeCode: 'TIRE_FEE',
    name: 'Test Tire Fee',
    jurisdictionRef: 'TEST-JURISDICTION-STATE-01',
    basis: 'FIXED_PER_UNIT',
    amount: '5.00',
    ratePercent: null,
    taxabilityFlag: false,
    effectiveFrom: '2025-01-01',
    effectiveTo: null,
    active: true,
    applicabilityTags: [{ itemClassCode: 'TIRE', documentTypeCode: null }],
    ...overrides,
  };
}

describe('fee-resolution', () => {
  it('resolves a fee whose tags match itemClassCode/documentTypeCode at businessDate', () => {
    const resolved = resolveApplicableFees([fee()], '2025-06-01', 'TIRE', 'COUNTER_SALE');
    expect(resolved).toHaveLength(1);
  });

  it('empty/no-match table truthfully returns nothing — no error, no estimate', () => {
    expect(resolveApplicableFees([], '2025-06-01', 'TIRE', 'COUNTER_SALE')).toEqual([]);
    expect(resolveApplicableFees([fee()], '2025-06-01', 'PARTS', 'COUNTER_SALE')).toEqual([]);
  });

  it('does not resolve an inactive fee table row', () => {
    expect(resolveApplicableFees([fee({ active: false })], '2025-06-01', 'TIRE', 'COUNTER_SALE')).toEqual([]);
  });

  it('history-proof: resolves the version effective at a backdated businessDate across a boundary', () => {
    const v1 = fee({ id: 'v1', amount: '4.00', effectiveFrom: '2024-01-01', effectiveTo: '2024-12-31' });
    const v2 = fee({ id: 'v2', amount: '5.00', effectiveFrom: '2025-01-01', effectiveTo: null });
    expect(resolveApplicableFees([v1, v2], '2024-06-01', 'TIRE', 'COUNTER_SALE')[0]?.id).toBe('v1');
    expect(resolveApplicableFees([v1, v2], '2025-06-01', 'TIRE', 'COUNTER_SALE')[0]?.id).toBe('v2');
  });

  it('does not resolve a fee with no applicability tags at all', () => {
    expect(resolveApplicableFees([fee({ applicabilityTags: [] })], '2025-06-01', 'TIRE', 'COUNTER_SALE')).toEqual([]);
  });

  describe('validateFeeAmountBasis', () => {
    it('accepts amount-only for FIXED_PER_UNIT/FIXED_PER_DOCUMENT', () => {
      expect(validateFeeAmountBasis('FIXED_PER_UNIT', '5.00', null)).toBeNull();
      expect(validateFeeAmountBasis('FIXED_PER_DOCUMENT', '5.00', undefined)).toBeNull();
    });

    it('rejects amount for FIXED_PER_UNIT when missing', () => {
      expect(validateFeeAmountBasis('FIXED_PER_UNIT', null, null)).toMatch(/requires amount only/);
    });

    it('rejects both amount and ratePercent set simultaneously', () => {
      expect(validateFeeAmountBasis('FIXED_PER_UNIT', '5.00', '1.5')).toMatch(/requires amount only/);
      expect(validateFeeAmountBasis('PERCENT_OF_BASE', '5.00', '1.5')).toMatch(/requires ratePercent only/);
    });

    it('accepts ratePercent-only for PERCENT_OF_BASE', () => {
      expect(validateFeeAmountBasis('PERCENT_OF_BASE', null, '1.5')).toBeNull();
    });
  });
});

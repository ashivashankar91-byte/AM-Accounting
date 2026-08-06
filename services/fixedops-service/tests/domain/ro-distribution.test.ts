import { describe, it, expect } from 'vitest';
import { assertRoCloseConserves, payTypeMixLabel, groupByPayType } from '../../src/domain/ro-distribution';
import { DistributionConservationError, FixedOpsValidationError } from '../../src/domain/errors';

const baseReq = {
  tenantId: 't1', legalEntityId: 'le1', storeId: 's1', roNumber: 'RO-1', businessDate: '2026-08-01',
};

describe('assertRoCloseConserves', () => {
  it('passes when line sale amounts sum exactly to the RO total', () => {
    expect(() => assertRoCloseConserves({
      ...baseReq, totalSaleAmount: '300.00',
      lines: [
        { lineId: 'l1', payType: 'C', category: 'LABOR', saleAmount: '100.00' },
        { lineId: 'l2', payType: 'W', category: 'PARTS', saleAmount: '150.00' },
        { lineId: 'l3', payType: 'I', category: 'MISC', saleAmount: '50.00' },
      ],
    })).not.toThrow();
  });

  it('throws DistributionConservationError on a one-cent mismatch', () => {
    expect(() => assertRoCloseConserves({
      ...baseReq, totalSaleAmount: '300.01',
      lines: [{ lineId: 'l1', payType: 'C', category: 'LABOR', saleAmount: '300.00' }],
    })).toThrow(DistributionConservationError);
  });

  it('rejects an invalid pay type', () => {
    expect(() => assertRoCloseConserves({
      ...baseReq, totalSaleAmount: '100.00',
      lines: [{ lineId: 'l1', payType: 'X' as any, category: 'LABOR', saleAmount: '100.00' }],
    })).toThrow(FixedOpsValidationError);
  });

  it('rejects zero lines', () => {
    expect(() => assertRoCloseConserves({ ...baseReq, totalSaleAmount: '0', lines: [] })).toThrow(FixedOpsValidationError);
  });
});

describe('payTypeMixLabel / groupByPayType', () => {
  const lines = [
    { lineId: 'l1', payType: 'C' as const, category: 'LABOR' as const, saleAmount: '10' },
    { lineId: 'l2', payType: 'W' as const, category: 'PARTS' as const, saleAmount: '20' },
    { lineId: 'l3', payType: 'C' as const, category: 'FEE' as const, saleAmount: '5' },
  ];

  it('produces a stable sorted mix label', () => {
    expect(payTypeMixLabel(lines)).toBe('C+W');
  });

  it('groups lines by pay type without dropping or duplicating any line', () => {
    const grouped = groupByPayType(lines);
    expect(grouped.C).toHaveLength(2);
    expect(grouped.W).toHaveLength(1);
    expect(grouped.I).toHaveLength(0);
  });
});

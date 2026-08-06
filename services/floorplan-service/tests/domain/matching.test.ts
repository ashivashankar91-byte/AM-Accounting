import { describe, it, expect } from 'vitest';
import { classifyStagedRow, findWeHaveLenderDoesntBreaks } from '../../src/domain/matching';

describe('classifyStagedRow', () => {
  it('an ADVANCE with no existing item matches (opens a new item)', () => {
    expect(classifyStagedRow({ rowType: 'ADVANCE', amount: '25000.00' }, null)).toEqual({ kind: 'MATCH_ADVANCE' });
  });

  it('an ADVANCE against an already-open item still matches (top-up)', () => {
    const existing = { status: 'OPEN' as const, remainingBalance: '10000.00' };
    expect(classifyStagedRow({ rowType: 'ADVANCE', amount: '5000.00' }, existing)).toEqual({ kind: 'MATCH_ADVANCE' });
  });

  it('a PAYOFF with no existing item is a lender-has/we-dont break', () => {
    expect(classifyStagedRow({ rowType: 'PAYOFF', amount: '25000.00' }, null)).toEqual({ kind: 'BREAK_LENDER_HAS_WE_DONT' });
  });

  it('a PAYOFF exactly equal to the remaining balance fully relieves', () => {
    const existing = { status: 'OPEN' as const, remainingBalance: '25000.00' };
    expect(classifyStagedRow({ rowType: 'PAYOFF', amount: '25000.00' }, existing)).toEqual({ kind: 'MATCH_PAYOFF', relievesFully: true });
  });

  it('a PAYOFF less than the remaining balance partially relieves', () => {
    const existing = { status: 'OPEN' as const, remainingBalance: '25000.00' };
    expect(classifyStagedRow({ rowType: 'PAYOFF', amount: '10000.00' }, existing)).toEqual({ kind: 'MATCH_PAYOFF', relievesFully: false });
  });

  it('a PAYOFF greater than the remaining balance is an amount-variance break', () => {
    const existing = { status: 'OPEN' as const, remainingBalance: '25000.00' };
    const result = classifyStagedRow({ rowType: 'PAYOFF', amount: '25100.00' }, existing);
    expect(result).toEqual({ kind: 'BREAK_AMOUNT_VARIANCE', varianceAmount: '100.00' });
  });
});

describe('findWeHaveLenderDoesntBreaks', () => {
  it('flags our open items whose applyNumber is absent from the lender batch', () => {
    const ours = [
      { applyNumber: 'VIN1', vin: 'VIN1', stockNumber: null },
      { applyNumber: 'VIN2', vin: 'VIN2', stockNumber: null },
    ];
    const lenderSet = new Set(['VIN1']);
    expect(findWeHaveLenderDoesntBreaks(ours, lenderSet)).toEqual([{ applyNumber: 'VIN2', vin: 'VIN2', stockNumber: null }]);
  });

  it('returns nothing when every open item is present in the lender batch', () => {
    const ours = [{ applyNumber: 'VIN1', vin: 'VIN1', stockNumber: null }];
    expect(findWeHaveLenderDoesntBreaks(ours, new Set(['VIN1']))).toEqual([]);
  });
});

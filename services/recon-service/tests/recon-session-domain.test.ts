// S054A — pure domain-rule unit tests for the Manual Bank Reconciliation
// Workbench. No I/O, no database.
import { describe, it, expect } from 'vitest';
import {
  canAddLine, canMatch, canUnmatch, canComplete, checkConservation, isValidBookItemType, isValidStatementLineSource,
  ReconOutOfBalanceError,
} from '../src/domain/recon-session';

describe('recon-session domain rules', () => {
  it('canAddLine/canMatch/canUnmatch/canComplete are true only while OPEN', () => {
    expect(canAddLine('OPEN')).toBe(true);
    expect(canAddLine('COMPLETED')).toBe(false);
    expect(canMatch('OPEN')).toBe(true);
    expect(canMatch('COMPLETED')).toBe(false);
    expect(canUnmatch('OPEN')).toBe(true);
    expect(canUnmatch('COMPLETED')).toBe(false);
    expect(canComplete('OPEN')).toBe(true);
    expect(canComplete('COMPLETED')).toBe(false);
  });

  it('isValidBookItemType accepts exactly PAYMENT/DEPOSIT/FEE/NSF/SWEEP', () => {
    for (const t of ['PAYMENT', 'DEPOSIT', 'FEE', 'NSF', 'SWEEP']) expect(isValidBookItemType(t)).toBe(true);
    expect(isValidBookItemType('BOGUS')).toBe(false);
  });

  it('isValidStatementLineSource accepts exactly MANUAL/IMPORTED', () => {
    expect(isValidStatementLineSource('MANUAL')).toBe(true);
    expect(isValidStatementLineSource('IMPORTED')).toBe(true);
    expect(isValidStatementLineSource('BOGUS')).toBe(false);
  });

  it('checkConservation passes silently when cleared + outstanding exactly equals the statement ending balance', () => {
    expect(() => checkConservation(['100.00', '250.50'], ['49.50'], '400.00')).not.toThrow();
  });

  it('checkConservation refuses (named error) when the totals do not exactly match, even by one cent', () => {
    expect(() => checkConservation(['100.00'], ['49.49'], '150.00')).toThrow(ReconOutOfBalanceError);
    try {
      checkConservation(['100.00'], ['49.49'], '150.00');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ReconOutOfBalanceError);
      expect(err.code).toBe('RECON_OUT_OF_BALANCE');
      expect(err.clearedCents).toBe(10000);
      expect(err.outstandingCents).toBe(4949);
      expect(err.statementCents).toBe(15000);
    }
  });

  it('checkConservation handles an empty book-item set against a zero statement balance', () => {
    expect(() => checkConservation([], [], '0.00')).not.toThrow();
    expect(() => checkConservation([], [], '0.01')).toThrow(ReconOutOfBalanceError);
  });
});

import { describe, it, expect } from 'vitest';
import {
  sumDebitsCredits, assertConserved, comparePhases, computeControlTotals, round2,
  UnbalancedConversionBatchError, ControlTotalSnapshot,
} from '../../src/domain/control-total-calculator';

describe('debit/credit conservation', () => {
  it('reports a balanced batch as balanced with a zero delta', () => {
    const result = sumDebitsCredits([
      { debit: 125000.0 }, { debit: 48250.75 }, { credit: 61300.25 }, { credit: 111950.5 },
    ]);
    expect(result.balanced).toBe(true);
    expect(result.totalDebit).toBeCloseTo(173250.75, 2);
    expect(result.totalCredit).toBeCloseTo(173250.75, 2);
    expect(result.delta).toBe(0);
    expect(result.lineCount).toBe(4);
  });

  it('detects a one-cent imbalance', () => {
    const result = sumDebitsCredits([{ debit: 10000.0 }, { credit: 9999.99 }]);
    expect(result.balanced).toBe(false);
    expect(result.delta).toBeCloseTo(0.01, 2);
  });

  it('accumulates without floating-point drift over many small lines', () => {
    const lines = Array.from({ length: 300 }, () => ({ debit: 0.1, credit: 0.1 }));
    const result = sumDebitsCredits(lines);
    expect(result.balanced).toBe(true);
    expect(result.totalDebit).toBe(30);
    expect(result.totalCredit).toBe(30);
  });

  it('treats missing debit or credit as zero rather than NaN', () => {
    const result = sumDebitsCredits([{ debit: 100 }, { credit: 100 }]);
    expect(result.totalDebit).toBe(100);
    expect(result.totalCredit).toBe(100);
    expect(result.balanced).toBe(true);
  });

  it('reports an empty batch as balanced', () => {
    expect(sumDebitsCredits([]).balanced).toBe(true);
  });
});

describe('assertConserved', () => {
  it('returns the conservation result for a balanced batch', () => {
    expect(assertConserved([{ debit: 500 }, { credit: 500 }]).balanced).toBe(true);
  });

  it('throws UnbalancedConversionBatchError with a STRUCTURAL_IMBALANCE code', () => {
    let thrown: unknown;
    try {
      assertConserved([{ debit: 500 }, { credit: 499.5 }]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(UnbalancedConversionBatchError);
    expect((thrown as UnbalancedConversionBatchError).code).toBe('STRUCTURAL_IMBALANCE');
    expect((thrown as UnbalancedConversionBatchError).result.delta).toBeCloseTo(0.5, 2);
  });

  it('names both totals in the message so the break is diagnosable from the log alone', () => {
    expect(() => assertConserved([{ debit: 1 }, { credit: 2 }]))
      .toThrow(/debits 1\.00 vs credits 2\.00/);
  });
});

describe('computeControlTotals', () => {
  it('separates accepted from rejected rows', () => {
    const snapshot = computeControlTotals('STAGING', [
      { stagedData: { debit: 100, credit: 0, documentRef: 'A' } },
      { stagedData: { debit: 0, credit: 100, documentRef: 'A' } },
      { stagedData: { debit: 50, credit: 0, documentRef: 'B' }, validationErrors: ['UNMAPPED_ACCOUNT'] },
    ]);
    expect(snapshot.rowCount).toBe(3);
    expect(snapshot.acceptedCount).toBe(2);
    expect(snapshot.rejectedCount).toBe(1);
    expect(snapshot.totalDebit).toBe(100);
    expect(snapshot.totalCredit).toBe(100);
    expect(snapshot.documentCount).toBe(1);
  });

  it('excludes rejected rows from monetary totals entirely', () => {
    const snapshot = computeControlTotals('STAGING', [
      { stagedData: { debit: 100, credit: 0 } },
      { stagedData: { debit: 999999, credit: 0 }, state: 'ERROR' },
    ]);
    expect(snapshot.totalDebit).toBe(100);
  });

  it('rolls open-item amounts into the schedule balance', () => {
    const snapshot = computeControlTotals('STAGING', [
      { stagedData: { openItemAmount: 18000 } },
      { stagedData: { openItemAmount: 21250.75 } },
    ]);
    expect(snapshot.openItemTotal).toBeCloseTo(39250.75, 2);
    expect(snapshot.scheduleBalance).toBeCloseTo(39250.75, 2);
  });
});

describe('comparePhases', () => {
  const base: ControlTotalSnapshot = {
    phase: 'EXTRACT', rowCount: 4, acceptedCount: 4, rejectedCount: 0,
    totalDebit: 100, totalCredit: 100, openItemTotal: 0, scheduleBalance: 0,
    documentCount: 2, exceptionCount: 0, duplicateCount: 0,
  };

  it('reconciles when every extracted row is accounted for and totals are unchanged', () => {
    const to: ControlTotalSnapshot = { ...base, phase: 'STAGING' };
    const comparison = comparePhases(base, to);
    expect(comparison.reconciled).toBe(true);
    expect(comparison.discrepancies).toEqual([]);
    expect(comparison.fromPhase).toBe('EXTRACT');
    expect(comparison.toPhase).toBe('STAGING');
  });

  it('surfaces rows that vanished between phases', () => {
    const to: ControlTotalSnapshot = { ...base, phase: 'STAGING', acceptedCount: 3, rejectedCount: 0 };
    const comparison = comparePhases(base, to);
    expect(comparison.reconciled).toBe(false);
    expect(comparison.discrepancies.map((d) => d.metric)).toContain('rowCount');
  });

  it('accepts rows that moved from accepted to rejected without loss', () => {
    const to: ControlTotalSnapshot = { ...base, phase: 'STAGING', acceptedCount: 3, rejectedCount: 1 };
    expect(comparePhases(base, to).discrepancies.map((d) => d.metric)).not.toContain('rowCount');
  });

  it('surfaces a monetary drift of more than a cent', () => {
    const to: ControlTotalSnapshot = { ...base, phase: 'STAGING', totalDebit: 100.02 };
    const comparison = comparePhases(base, to);
    expect(comparison.reconciled).toBe(false);
    const drift = comparison.discrepancies.find((d) => d.metric === 'totalDebit');
    expect(drift?.delta).toBeCloseTo(0.02, 2);
  });

  it('tolerates sub-cent representation noise', () => {
    const to: ControlTotalSnapshot = { ...base, phase: 'STAGING', totalDebit: 100.001 };
    expect(comparePhases(base, to).reconciled).toBe(true);
  });
});

describe('round2', () => {
  it('rounds half away from zero at the cent', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
  });

  it('leaves already-rounded values untouched', () => {
    expect(round2(48250.75)).toBe(48250.75);
  });
});

import { describe, it, expect } from 'vitest';
import {
  computeDiffs, summarize, isExplained, validateSignOff, ComparisonSignOffError,
  EXPLAINED_CLASSIFICATIONS, ComparableFigure, ClassifiedDiff,
} from '../../src/domain/parallel-run-comparator';

function figure(dimension: string, value: number, diffType: ComparableFigure['diffType'] = 'TB_ACCOUNT'): ComparableFigure {
  return { diffType, dimension, value };
}

function classified(overrides: Partial<ClassifiedDiff> = {}): ClassifiedDiff {
  return { classification: 'TIMING', reason: 'Legacy posted in the following period', disposition: 'APPROVED', ...overrides };
}

describe('computeDiffs', () => {
  it('reports nothing when both sides agree exactly', () => {
    const legacy = [figure('1000', 125000), figure('2000', -125000)];
    expect(computeDiffs(legacy, [figure('1000', 125000), figure('2000', -125000)])).toEqual([]);
  });

  it('computes variance as modern minus legacy', () => {
    const diffs = computeDiffs([figure('1000', 100000)], [figure('1000', 101500)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.sourceValue).toBe(100000);
    expect(diffs[0]!.targetValue).toBe(101500);
    expect(diffs[0]!.variance).toBe(1500);
  });

  it('never silently drops a dimension present only on the legacy side', () => {
    const diffs = computeDiffs([figure('1000', 100), figure('4500', 250)], [figure('1000', 100)]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.dimension).toBe('4500');
    expect(diffs[0]!.targetValue).toBe(0);
    expect(diffs[0]!.variance).toBe(-250);
  });

  it('never silently drops a dimension present only on the modern side', () => {
    const diffs = computeDiffs([figure('1000', 100)], [figure('1000', 100), figure('7000', 42)]);
    expect(diffs.map((d) => d.dimension)).toEqual(['7000']);
    expect(diffs[0]!.sourceValue).toBe(0);
  });

  it('detects a one-cent difference', () => {
    expect(computeDiffs([figure('1000', 100.0)], [figure('1000', 100.01)])).toHaveLength(1);
  });

  it('ignores sub-cent representation noise', () => {
    expect(computeDiffs([figure('1000', 100.0)], [figure('1000', 100.001)])).toHaveLength(0);
  });

  it('keeps different diff types on the same dimension separate', () => {
    const diffs = computeDiffs(
      [figure('1200', 10, 'TB_ACCOUNT'), figure('1200', 20, 'SCHEDULE_CONTROL')],
      [figure('1200', 10, 'TB_ACCOUNT'), figure('1200', 25, 'SCHEDULE_CONTROL')],
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.diffType).toBe('SCHEDULE_CONTROL');
  });

  it('starts every difference as UNEXPLAINED — classification is a human act', () => {
    const diffs = computeDiffs([figure('1000', 1)], [figure('1000', 2)]);
    expect(diffs[0]!.classification).toBe('UNEXPLAINED');
  });

  it('returns diffs in a stable order for repeatable review', () => {
    const legacy = [figure('9000', 1), figure('1000', 1), figure('5000', 1)];
    const modern = [figure('9000', 2), figure('1000', 2), figure('5000', 2)];
    expect(computeDiffs(legacy, modern).map((d) => d.dimension))
      .toEqual(computeDiffs(legacy, modern).map((d) => d.dimension));
  });

  it('compares statement lines as well as accounts and controls', () => {
    const diffs = computeDiffs(
      [figure('GROSS_PROFIT', 500000, 'STATEMENT_LINE')],
      [figure('GROSS_PROFIT', 498000, 'STATEMENT_LINE')],
    );
    expect(diffs[0]!.diffType).toBe('STATEMENT_LINE');
    expect(diffs[0]!.variance).toBe(-2000);
  });
});

describe('isExplained', () => {
  it.each(EXPLAINED_CLASSIFICATIONS)('accepts a dispositioned %s difference with a reason', (classification) => {
    expect(isExplained(classified({ classification }))).toBe(true);
  });

  it('rejects an UNEXPLAINED difference even when a reason and approval exist', () => {
    expect(isExplained(classified({ classification: 'UNEXPLAINED' }))).toBe(false);
  });

  it('rejects a classified difference with no reason', () => {
    expect(isExplained(classified({ reason: null }))).toBe(false);
  });

  it('rejects a classified difference with a whitespace-only reason', () => {
    expect(isExplained(classified({ reason: '   ' }))).toBe(false);
  });

  it('rejects a classified difference that has not been dispositioned', () => {
    expect(isExplained(classified({ disposition: 'PENDING' }))).toBe(false);
  });
});

describe('summarize', () => {
  it('meets the exit criterion when every difference is explained and dispositioned — not when there are zero differences', () => {
    const summary = summarize([
      classified({ classification: 'TIMING' }),
      classified({ classification: 'MAPPING' }),
      classified({ classification: 'LEGACY_ERROR' }),
    ]);
    expect(summary.totalDiffs).toBe(3);
    expect(summary.explainedDiffs).toBe(3);
    expect(summary.unexplainedDiffs).toBe(0);
    expect(summary.exitCriterionMet).toBe(true);
  });

  it('fails the exit criterion while a single difference remains unexplained', () => {
    const summary = summarize([classified(), classified({ classification: 'UNEXPLAINED', reason: null })]);
    expect(summary.unexplainedDiffs).toBe(1);
    expect(summary.exitCriterionMet).toBe(false);
  });

  it('counts an approved-but-unreasoned difference as unexplained', () => {
    expect(summarize([classified({ reason: '' })]).unexplainedDiffs).toBe(1);
  });

  it('tallies each classification independently', () => {
    const summary = summarize([
      classified({ classification: 'TIMING' }), classified({ classification: 'TIMING' }),
      classified({ classification: 'MODERN_ERROR' }), classified({ classification: 'UNEXPLAINED', reason: null }),
    ]);
    expect(summary.byClassification).toEqual({ TIMING: 2, MAPPING: 0, LEGACY_ERROR: 0, MODERN_ERROR: 1, UNEXPLAINED: 1 });
  });

  it('meets the exit criterion vacuously on an empty difference set', () => {
    expect(summarize([]).exitCriterionMet).toBe(true);
  });
});

describe('validateSignOff', () => {
  it('permits a controller who did not operate the comparison to sign off', () => {
    const summary = validateSignOff({ operatorId: 'operator-1', signerId: 'controller-1', diffs: [classified()] });
    expect(summary.exitCriterionMet).toBe(true);
  });

  it('refuses when the operator and signer are the same identity', () => {
    let thrown: unknown;
    try {
      validateSignOff({ operatorId: 'operator-1', signerId: 'operator-1', diffs: [classified()] });
    } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(ComparisonSignOffError);
    expect((thrown as ComparisonSignOffError).code).toBe('SOD_VIOLATION');
  });

  it('refuses while any difference remains unexplained', () => {
    let thrown: unknown;
    try {
      validateSignOff({
        operatorId: 'operator-1', signerId: 'controller-1',
        diffs: [classified(), classified({ classification: 'UNEXPLAINED', reason: null })],
      });
    } catch (error) { thrown = error; }
    expect((thrown as ComparisonSignOffError).code).toBe('UNEXPLAINED_DIFFERENCES');
  });

  it('checks SoD before the exit criterion so a self-signer is never told it merely needs more work', () => {
    expect(() => validateSignOff({
      operatorId: 'operator-1', signerId: 'operator-1',
      diffs: [classified({ classification: 'UNEXPLAINED', reason: null })],
    })).toThrow(/may not also sign off/);
  });
});

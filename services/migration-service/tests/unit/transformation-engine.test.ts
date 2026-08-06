import { describe, it, expect } from 'vitest';
import {
  transform, computeRowHash, computeSourceRowHash, buildTransformationVersion, computeCoverage,
  stableStringify, MappingSetNotFrozenError, PinnedMappingSet, MappingDecision, SourceRowInput,
} from '../../src/domain/transformation-engine';

function decision(overrides: Partial<MappingDecision> = {}): MappingDecision {
  return {
    id: 'md-1', sourceField: 'legacyAccount', sourceValue: '100-00',
    targetField: 'accountCode', targetValue: '1000', classification: 'MAP', status: 'MAPPED',
    ...overrides,
  };
}

function mappingSet(entries: MappingDecision[], overrides: Partial<PinnedMappingSet> = {}): PinnedMappingSet {
  return { id: 'ms-1', version: 1, status: 'FROZEN', entries, ...overrides };
}

function row(id: string, rawData: Record<string, unknown>): SourceRowInput {
  return { id, rowIndex: Number(id.replace(/\D/g, '')) || 0, rawData };
}

const STANDARD_SET = mappingSet([
  decision({ id: 'md-1', sourceValue: '100-00', targetValue: '1000' }),
  decision({ id: 'md-2', sourceValue: '200-00', targetValue: '2000' }),
  decision({ id: 'md-3', sourceField: 'legacyDept', sourceValue: 'SVC', targetField: 'departmentCode', targetValue: 'SERVICE' }),
]);

describe('mapping set immutability requirement', () => {
  it('refuses to transform against a DRAFT mapping set', () => {
    expect(() => transform([row('r1', { legacyAccount: '100-00' })], mappingSet([decision()], { status: 'DRAFT' })))
      .toThrow(MappingSetNotFrozenError);
  });

  it('names the offending mapping set in the error', () => {
    expect(() => transform([], mappingSet([], { id: 'ms-draft', status: 'DRAFT' })))
      .toThrow(/ms-draft must be FROZEN/);
  });

  it('permits an explicit unfrozen preview without mutating anything', () => {
    const result = transform(
      [row('r1', { legacyAccount: '100-00', debit: 100 })],
      mappingSet([decision()], { status: 'DRAFT' }),
      { requireFrozen: false },
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe('determinism', () => {
  const rows = [
    row('r1', { legacyAccount: '100-00', legacyDept: 'SVC', debit: 1500, credit: 0, documentRef: 'JE-1' }),
    row('r2', { legacyAccount: '200-00', legacyDept: 'SVC', debit: 0, credit: 1500, documentRef: 'JE-2' }),
  ];

  it('produces byte-identical output for the same input and version', () => {
    const a = transform(rows, STANDARD_SET);
    const b = transform(rows, STANDARD_SET);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('produces the same row hashes regardless of raw field ordering', () => {
    const reordered = [
      row('r1', { documentRef: 'JE-1', credit: 0, debit: 1500, legacyDept: 'SVC', legacyAccount: '100-00' }),
      row('r2', { documentRef: 'JE-2', credit: 1500, debit: 0, legacyDept: 'SVC', legacyAccount: '200-00' }),
    ];
    expect(transform(reordered, STANDARD_SET).rows.map((r) => r.rowHash))
      .toEqual(transform(rows, STANDARD_SET).rows.map((r) => r.rowHash));
  });

  it('reads no clock and no randomness — repeated runs never drift', () => {
    const hashes = new Set(Array.from({ length: 25 }, () => transform(rows, STANDARD_SET).rows[0]!.rowHash));
    expect(hashes.size).toBe(1);
  });
});

describe('version pinning', () => {
  it('derives the transformation version from mapping set identity and version', () => {
    expect(buildTransformationVersion(mappingSet([], { id: 'ms-9', version: 4 })))
      .toBe('ce16.v1:mapping-ms-9:v4');
  });

  it('changes the row hash when the mapping version changes', () => {
    const v1 = transform([row('r1', { legacyAccount: '100-00', debit: 10 })], STANDARD_SET);
    const v2 = transform([row('r1', { legacyAccount: '100-00', debit: 10 })], { ...STANDARD_SET, version: 2 });
    expect(v2.transformationVersion).not.toBe(v1.transformationVersion);
    expect(v2.rows[0]!.rowHash).not.toBe(v1.rows[0]!.rowHash);
  });

  it('changes the row hash when the engine version changes', () => {
    const a = transform([row('r1', { legacyAccount: '100-00' })], STANDARD_SET);
    const b = transform([row('r1', { legacyAccount: '100-00' })], STANDARD_SET, { engineVersion: 'ce16.v2' });
    expect(b.rows[0]!.rowHash).not.toBe(a.rows[0]!.rowHash);
  });

  it('pins the transformation version into every row lineage record', () => {
    const result = transform([row('r1', { legacyAccount: '100-00' })], STANDARD_SET);
    expect(result.rows[0]!.lineageRef.transformationVersion).toBe(result.transformationVersion);
    expect(result.rows[0]!.lineageRef.mappingSetId).toBe('ms-1');
    expect(result.rows[0]!.lineageRef.sourceRowRef).toBe('r1');
  });
});

describe('never inventing legacy field meanings', () => {
  it('routes an unmapped value to the exception queue instead of guessing', () => {
    const result = transform([row('r1', { legacyAccount: '999-99' })], STANDARD_SET);
    expect(result.rows).toHaveLength(0);
    expect(result.exceptions[0]!.exceptionType).toBe('UNMAPPED');
    expect(result.exceptions[0]!.sourceValue).toBe('999-99');
  });

  it('routes conflicting decisions to AMBIGUOUS instead of picking one', () => {
    const conflicted = mappingSet([
      decision({ id: 'md-a', sourceValue: '300-00', targetValue: '3000' }),
      decision({ id: 'md-b', sourceValue: '300-00', targetValue: '3100' }),
    ]);
    const result = transform([row('r1', { legacyAccount: '300-00' })], conflicted);
    expect(result.rows).toHaveLength(0);
    expect(result.exceptions[0]!.exceptionType).toBe('AMBIGUOUS');
    expect((result.exceptions[0]!.evidence['candidates'] as unknown[])).toHaveLength(2);
  });

  it('blocks a row whose decision is still MANUAL_REVIEW_REQUIRED', () => {
    const pending = mappingSet([decision({ status: 'MANUAL_REVIEW_REQUIRED', classification: null })]);
    const result = transform([row('r1', { legacyAccount: '100-00' })], pending);
    expect(result.rows).toHaveLength(0);
    expect(result.exceptions[0]!.exceptionType).toBe('MAPPING_INCOMPLETE');
  });

  it('flags a duplicate source identity within one batch', () => {
    const result = transform([
      row('r1', { legacyAccount: '100-00', sourceIdentity: 'AR-1' }),
      row('r2', { legacyAccount: '100-00', sourceIdentity: 'AR-1' }),
    ], STANDARD_SET);
    expect(result.rows).toHaveLength(1);
    expect(result.exceptions[0]!.exceptionType).toBe('DUPLICATE');
    expect(result.exceptions[0]!.evidence['firstSourceRowId']).toBe('r1');
  });
});

describe('classification semantics', () => {
  it('ALIGN carries the source value straight through', () => {
    const set = mappingSet([decision({ sourceValue: '100-00', classification: 'ALIGN', targetValue: null })]);
    const staged = transform([row('r1', { legacyAccount: '100-00' })], set).rows[0]!.stagedData;
    expect(staged['accountCode']).toBe('100-00');
    expect(staged['accountCode__classification']).toBe('ALIGN');
  });

  it('MAP substitutes the target value', () => {
    const staged = transform([row('r1', { legacyAccount: '100-00' })], STANDARD_SET).rows[0]!.stagedData;
    expect(staged['accountCode']).toBe('1000');
    expect(staged['accountCode__classification']).toBe('MAP');
  });

  it('DIVERGE substitutes the target value and records the divergence', () => {
    const set = mappingSet([decision({ classification: 'DIVERGE', targetValue: '1050' })]);
    const staged = transform([row('r1', { legacyAccount: '100-00' })], set).rows[0]!.stagedData;
    expect(staged['accountCode']).toBe('1050');
    expect(staged['accountCode__classification']).toBe('DIVERGE');
  });

  it('EXCLUDED drops the field without failing the row', () => {
    const set = mappingSet([decision({ status: 'EXCLUDED' })]);
    const result = transform([row('r1', { legacyAccount: '100-00', debit: 5 })], set);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.stagedData['accountCode']).toBeUndefined();
    expect(result.rows[0]!.lineageRef.mappingDecisionRefs).toContain('md-1');
  });

  it('passes monetary fields through untouched — no mapping needed for amounts', () => {
    const staged = transform([row('r1', { legacyAccount: '100-00', debit: 1234.56, credit: 0 })], STANDARD_SET)
      .rows[0]!.stagedData;
    expect(staged['debit']).toBe(1234.56);
    expect(staged['credit']).toBe(0);
  });
});

describe('hashing primitives', () => {
  it('stableStringify is order-independent for objects', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('stableStringify is order-sensitive for arrays', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('computeSourceRowHash is stable across key ordering and unique per content', () => {
    expect(computeSourceRowHash({ a: 1, b: 2 })).toBe(computeSourceRowHash({ b: 2, a: 1 }));
    expect(computeSourceRowHash({ a: 1 })).not.toBe(computeSourceRowHash({ a: 2 }));
  });

  it('computeRowHash separates identity from payload so concatenation cannot collide', () => {
    expect(computeRowHash('AB', { x: 'C' }, 'v1')).not.toBe(computeRowHash('A', { x: 'BC' }, 'v1'));
  });
});

describe('coverage meter', () => {
  it('reports 100% and complete only when nothing is left in manual review', () => {
    const meter = computeCoverage([
      decision({ id: '1', classification: 'ALIGN' }),
      decision({ id: '2', classification: 'MAP' }),
      decision({ id: '3', classification: 'DIVERGE' }),
      decision({ id: '4', status: 'EXCLUDED' }),
    ]);
    expect(meter.coveragePercent).toBe(100);
    expect(meter.complete).toBe(true);
    expect(meter.byClassification).toMatchObject({ ALIGN: 1, MAP: 1, DIVERGE: 1, EXCLUDED: 1 });
  });

  it('reports incomplete coverage while any entry is unresolved', () => {
    const meter = computeCoverage([
      decision({ id: '1', classification: 'MAP' }),
      decision({ id: '2', status: 'MANUAL_REVIEW_REQUIRED', classification: null }),
    ]);
    expect(meter.coveragePercent).toBe(50);
    expect(meter.manualReviewRequired).toBe(1);
    expect(meter.complete).toBe(false);
  });

  it('treats an empty mapping set as not complete rather than trivially complete', () => {
    const meter = computeCoverage([]);
    expect(meter.coveragePercent).toBe(0);
    expect(meter.complete).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { computeDocumentDiff } from '../../src/domain/diff';

describe('computeDocumentDiff (S098 diff alerts)', () => {
  it('detects no diff for identical documents', () => {
    const doc = { specVersion: '2.1', rowCount: 1, rows: [{ rowIndex: 0, fields: { amount: '100.00' } }] };
    expect(computeDocumentDiff(doc, doc)).toHaveLength(0);
  });

  it('detects a spec version change', () => {
    const prior = { specVersion: '2.1', rowCount: 1, rows: [{ rowIndex: 0, fields: { amount: '100.00' } }] };
    const next = { specVersion: '2.2', rowCount: 1, rows: [{ rowIndex: 0, fields: { amount: '100.00' } }] };
    const diffs = computeDocumentDiff(prior, next);
    expect(diffs).toContainEqual({ path: 'specVersion', before: '2.1', after: '2.2' });
  });

  it('detects a row-count change and a field-level amount change', () => {
    const prior = { specVersion: '2.1', rowCount: 1, rows: [{ rowIndex: 0, fields: { amount: '100.00' } }] };
    const next = { specVersion: '2.1', rowCount: 2, rows: [{ rowIndex: 0, fields: { amount: '125.00' } }, { rowIndex: 1, fields: { amount: '50.00' } }] };
    const diffs = computeDocumentDiff(prior, next);
    expect(diffs).toContainEqual({ path: 'rowCount', before: 1, after: 2 });
    expect(diffs).toContainEqual({ path: 'row[0].amount', before: '100.00', after: '125.00' });
    expect(diffs).toContainEqual({ path: 'row[1]', before: null, after: { amount: '50.00' } });
  });

  it('detects a row removed in the new document', () => {
    const prior = { specVersion: '2.1', rowCount: 2, rows: [{ rowIndex: 0, fields: { amount: '1' } }, { rowIndex: 1, fields: { amount: '2' } }] };
    const next = { specVersion: '2.1', rowCount: 1, rows: [{ rowIndex: 0, fields: { amount: '1' } }] };
    const diffs = computeDocumentDiff(prior, next);
    expect(diffs).toContainEqual({ path: 'row[1]', before: { amount: '2' }, after: null });
  });
});

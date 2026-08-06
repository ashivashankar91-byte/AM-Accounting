import { describe, it, expect } from 'vitest';
import {
  evaluateG1, evaluateG2, evaluateG3, evaluateG4, evaluateG5, evaluateAllGates, allGatesPassed, StagedItem,
} from '../../src/domain/gate-evaluator';

const AS_OF = '2025-12-31';

function item(overrides: Partial<StagedItem> = {}): StagedItem {
  return {
    sourceIdentity: 'AR-INV-0001',
    controlAccount: '1200',
    amount: 1000,
    documentDate: '2025-12-20',
    dueDate: '2026-01-19',
    agingBucket: '1_30',
    validationErrors: [],
    alreadyPromoted: false,
    ...overrides,
  };
}

describe('G1 — item-level validity', () => {
  it('passes when every item is structurally complete', () => {
    expect(evaluateG1([item(), item({ sourceIdentity: 'AR-INV-0002' })]).result).toBe('PASS');
  });

  it('fails an item carrying transformation validation errors', () => {
    const result = evaluateG1([item({ validationErrors: ['UNMAPPED_ACCOUNT'] })]);
    expect(result.result).toBe('FAIL');
    expect(result.details['invalidCount']).toBe(1);
  });

  it.each([
    ['missing control account', { controlAccount: '' }],
    ['missing source identity', { sourceIdentity: '' }],
    ['missing document date', { documentDate: null }],
    ['non-finite amount', { amount: Number.NaN }],
  ])('fails on %s', (_label, override) => {
    expect(evaluateG1([item(override as Partial<StagedItem>)]).result).toBe('FAIL');
  });

  it('passes vacuously on an empty batch', () => {
    expect(evaluateG1([]).result).toBe('PASS');
  });
});

describe('G2 — subledger conservation', () => {
  it('passes when staged items sum exactly to the converted TB control balance', () => {
    const items = [
      item({ sourceIdentity: 'A', amount: 18000 }),
      item({ sourceIdentity: 'B', amount: 21250.75 }),
      item({ sourceIdentity: 'C', amount: 9000 }),
    ];
    expect(evaluateG2(items, { '1200': 48250.75 }).result).toBe('PASS');
  });

  it('fails on a one-cent shortfall', () => {
    const result = evaluateG2([item({ amount: 48250.74 })], { '1200': 48250.75 });
    expect(result.result).toBe('FAIL');
    expect((result.details['breaches'] as any[])[0].variance).toBeCloseTo(-0.01, 2);
  });

  it('fails when the TB carries a control account the subledger does not', () => {
    const result = evaluateG2([item({ amount: 1000 })], { '1200': 1000, '2000': -5000 });
    expect(result.result).toBe('FAIL');
    expect((result.details['breaches'] as any[]).map((b) => b.controlAccount)).toContain('2000');
  });

  it('fails when the subledger carries a control account the TB does not', () => {
    expect(evaluateG2([item({ controlAccount: '9999', amount: 10 })], { '1200': 0 }).result).toBe('FAIL');
  });

  it('conserves negative (credit-balance) control accounts', () => {
    const items = [
      item({ sourceIdentity: 'D', controlAccount: '2000', amount: -35000 }),
      item({ sourceIdentity: 'E', controlAccount: '2000', amount: -26300.25 }),
    ];
    expect(evaluateG2(items, { '2000': -61300.25 }).result).toBe('PASS');
  });
});

describe('G3 — duplicate / identity', () => {
  it('passes when every source identity appears once', () => {
    expect(evaluateG3([item({ sourceIdentity: 'A' }), item({ sourceIdentity: 'B' })]).result).toBe('PASS');
  });

  it('fails when the same identity appears twice in one batch', () => {
    const result = evaluateG3([item({ sourceIdentity: 'A' }), item({ sourceIdentity: 'A' })]);
    expect(result.result).toBe('FAIL');
    expect(result.details['duplicateCount']).toBe(1);
  });

  it('fails when an identity was already promoted by an earlier run', () => {
    const result = evaluateG3([item({ sourceIdentity: 'A', alreadyPromoted: true })]);
    expect(result.result).toBe('FAIL');
    expect(result.details['alreadyPromotedCount']).toBe(1);
  });
});

describe('G4 — aging integrity', () => {
  it('passes when declared buckets agree with computed buckets and totals reconstruct', () => {
    const items = [
      item({ sourceIdentity: 'A', documentDate: '2025-12-31', agingBucket: 'CURRENT', amount: 4200 }),
      item({ sourceIdentity: 'B', documentDate: '2025-12-20', agingBucket: '1_30', amount: 1800 }),
      item({ sourceIdentity: 'C', documentDate: '2025-11-20', agingBucket: '31_60', amount: 900 }),
      item({ sourceIdentity: 'D', documentDate: '2025-10-15', agingBucket: '61_90', amount: 650 }),
      item({ sourceIdentity: 'E', documentDate: '2025-08-01', agingBucket: 'OVER_90', amount: 400 }),
    ];
    const result = evaluateG4(items, AS_OF);
    expect(result.result).toBe('PASS');
    expect(result.details['bucketSum']).toBeCloseTo(7950, 2);
    expect(result.details['itemTotal']).toBeCloseTo(7950, 2);
  });

  it('fails when a declared bucket contradicts the computed bucket', () => {
    const result = evaluateG4([item({ documentDate: '2025-06-01', agingBucket: 'CURRENT' })], AS_OF);
    expect(result.result).toBe('FAIL');
    expect(result.details['bucketMismatchCount']).toBe(1);
  });

  it('fails a future-dated document', () => {
    const result = evaluateG4([item({ documentDate: '2026-03-01', agingBucket: 'CURRENT' })], AS_OF);
    expect(result.result).toBe('FAIL');
    expect(result.details['futureDatedCount']).toBe(1);
  });

  it('fails an unrecognised aging bucket rather than silently accepting it', () => {
    const result = evaluateG4([item({ agingBucket: 'SOMEDAY' })], AS_OF);
    expect(result.result).toBe('FAIL');
    expect(result.details['unknownBucketCount']).toBe(1);
  });

  it('blocks rather than passes when no as-of date is supplied', () => {
    const result = evaluateG4([item()], null);
    expect(result.result).toBe('BLOCKED');
    expect(result.details['reason']).toBe('AGING_AS_OF_NOT_SUPPLIED');
  });
});

describe('G5 — exception queue zero-or-dispositioned', () => {
  it('passes on an empty queue', () => {
    expect(evaluateG5([]).result).toBe('PASS');
  });

  it('passes when every blocking exception has been dispositioned', () => {
    const result = evaluateG5([
      { blocking: true, disposition: 'APPROVED' },
      { blocking: true, disposition: 'CORRECTED' },
      { blocking: true, disposition: 'REJECTED' },
    ]);
    expect(result.result).toBe('PASS');
    expect(result.details['totalExceptions']).toBe(3);
  });

  it('fails while any blocking exception is still pending', () => {
    const result = evaluateG5([{ blocking: true, disposition: 'PENDING' }]);
    expect(result.result).toBe('FAIL');
    expect(result.details['outstandingBlocking']).toBe(1);
  });

  it('ignores non-blocking pending exceptions', () => {
    expect(evaluateG5([{ blocking: false, disposition: 'PENDING' }]).result).toBe('PASS');
  });
});

describe('dataset-aware gating', () => {
  it('G1 still demands a document date for item-level datasets', () => {
    expect(evaluateG1([item({ documentDate: null })], { itemLevel: true }).result).toBe('FAIL');
  });

  it('G1 does not demand a document date for whole-balance datasets', () => {
    const result = evaluateG1([item({ documentDate: null })], { itemLevel: false });
    expect(result.result).toBe('PASS');
    expect(result.details['itemLevel']).toBe(false);
  });

  it('G1 still rejects a structurally broken row on a whole-balance dataset', () => {
    expect(evaluateG1([item({ controlAccount: '', documentDate: null })], { itemLevel: false }).result).toBe('FAIL');
  });

  it('G4 declares aging not applicable rather than inventing buckets for a balance dataset', () => {
    const result = evaluateG4([item({ documentDate: null, agingBucket: null })], null, { itemLevel: false });
    expect(result.result).toBe('PASS');
    expect(result.details['reason']).toBe('AGING_NOT_APPLICABLE_TO_BALANCE_DATASET');
  });

  it('evaluateAllGates threads itemLevel through to G1 and G4', () => {
    const results = evaluateAllGates({
      items: [item({ documentDate: null, agingBucket: null })],
      itemLevel: false,
      convertedControlBalances: { '1200': 1000 },
      agingAsOf: null,
      exceptions: [],
    });
    expect(allGatesPassed(results)).toBe(true);
  });

  it('evaluateAllGates defaults to full item-level strictness', () => {
    const results = evaluateAllGates({
      items: [item({ documentDate: null })],
      convertedControlBalances: { '1200': 1000 },
      agingAsOf: AS_OF,
      exceptions: [],
    });
    expect(results.find((r) => r.gateCode === 'G1')!.result).toBe('FAIL');
  });
});

describe('evaluateAllGates', () => {
  it('returns G1 through G5 in order', () => {
    const results = evaluateAllGates({
      items: [item()], convertedControlBalances: { '1200': 1000 }, agingAsOf: AS_OF, exceptions: [],
    });
    expect(results.map((r) => r.gateCode)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
    expect(allGatesPassed(results)).toBe(true);
  });

  it('reports allGatesPassed false when any single gate fails', () => {
    const results = evaluateAllGates({
      items: [item()], convertedControlBalances: { '1200': 999 }, agingAsOf: AS_OF, exceptions: [],
    });
    expect(allGatesPassed(results)).toBe(false);
    expect(results.find((r) => r.gateCode === 'G2')!.result).toBe('FAIL');
  });

  it('treats an empty result set as not passed', () => {
    expect(allGatesPassed([])).toBe(false);
  });
});

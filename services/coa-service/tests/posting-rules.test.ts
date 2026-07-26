/**
 * S013 — Balanced Journal Posting rule engine (pure evaluator) tests.
 * This is the SINGLE rule source shared by posting (S013) and validation (S215).
 * Named CI cases cover the full BR013 violation matrix (BR013-1..6) plus the
 * happy path and determinism (rebuild-equivalence: same inputs => same result).
 */

import { describe, it, expect } from 'vitest';
import {
  evaluate,
  balanceDelta,
  toCents,
  PostingContext,
  PostingHeaderInput,
  PostingLineInput,
  ResolvedAccount,
} from '../src/domain/journal-posting';

const CASH: ResolvedAccount = { id: 'a-cash', accountNumber: '10000', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'ACTIVE' };
const REV: ResolvedAccount = { id: 'a-rev', accountNumber: '49000', type: 'REVENUE', normalBalance: 'CR', postable: true, status: 'ACTIVE' };
const SUMMARY: ResolvedAccount = { id: 'a-sum', accountNumber: '10100', type: 'ASSET', normalBalance: 'DR', postable: false, status: 'ACTIVE' };
const INACTIVE: ResolvedAccount = { id: 'a-off', accountNumber: '12430', type: 'ASSET', normalBalance: 'DR', postable: true, status: 'INACTIVE' };

function ctx(overrides: Partial<PostingContext> = {}): PostingContext {
  const accounts = new Map<string, ResolvedAccount>([
    [CASH.id, CASH],
    [REV.id, REV],
    [SUMMARY.id, SUMMARY],
    [INACTIVE.id, INACTIVE],
  ]);
  return {
    callerClass: 'MANUAL',
    accounts,
    period: { id: 'p1', code: '2026-01', status: 'OPEN', adjustmentsOnly: false },
    source: { code: 'GJ', sourceClass: 'MANUAL', status: 'ACTIVE' },
    ...overrides,
  };
}

const header: PostingHeaderInput = { entityId: 'e1', date: '2026-01-15', sourceCode: 'GJ', memo: 'test', idempotencyKey: 'idem-1' };

// A balanced pair: DR cash 100 / CR revenue 100 (revenue is P&L -> needs dept).
const balanced: PostingLineInput[] = [
  { accountId: CASH.id, storeId: '01', dr: 100 },
  { accountId: REV.id, storeId: '01', deptCode: 'SVC', cr: 100 },
];

function rules(vs: { rule: string }[]) {
  return vs.map((v) => v.rule);
}

describe('S013 evaluate — happy path', () => {
  it('CASE 1: a balanced two-line entry in an open period with valid source/accounts passes', () => {
    const r = evaluate(header, balanced, ctx());
    expect(r.pass).toBe(true);
    expect(r.violations).toHaveLength(0);
    expect(r.deltaDr).toBe(100);
    expect(r.deltaCr).toBe(100);
  });
});

describe('S013 evaluate — BR013-1 balance & amount shape', () => {
  it('CASE 2: unbalanced debits != credits is rejected (BR013-1)', () => {
    const r = evaluate(header, [
      { accountId: CASH.id, storeId: '01', dr: 100 },
      { accountId: REV.id, storeId: '01', deptCode: 'SVC', cr: 90 },
    ], ctx());
    expect(r.pass).toBe(false);
    expect(rules(r.violations)).toContain('BR013-1');
  });

  it('CASE 3: a line with both debit and credit set is rejected (BR013-1)', () => {
    const r = evaluate(header, [
      { accountId: CASH.id, storeId: '01', dr: 100, cr: 100 },
      { accountId: REV.id, storeId: '01', deptCode: 'SVC', cr: 100 },
    ], ctx());
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'BR013-1' && v.lineIndex === 0)).toBe(true);
  });

  it('CASE 4: a line with neither debit nor credit is rejected (BR013-1)', () => {
    const r = evaluate(header, [
      { accountId: CASH.id, storeId: '01' },
      { accountId: REV.id, storeId: '01', deptCode: 'SVC' },
    ], ctx());
    expect(r.pass).toBe(false);
    expect(r.violations.filter((v) => v.rule === 'BR013-1' && v.field === 'amount').length).toBeGreaterThanOrEqual(2);
  });

  it('balances to the cent (99.995 rounding does not create phantom drift)', () => {
    const r = evaluate(header, [
      { accountId: CASH.id, storeId: '01', dr: '100.01' },
      { accountId: REV.id, storeId: '01', deptCode: 'SVC', cr: '100.01' },
    ], ctx());
    expect(r.pass).toBe(true);
  });
});

describe('S013 evaluate — BR013-2 period eligibility', () => {
  it('CASE 5a: a date resolving to no period is rejected (BR013-2)', () => {
    const r = evaluate(header, balanced, ctx({ period: null }));
    expect(r.pass).toBe(false);
    expect(rules(r.violations)).toContain('BR013-2');
  });

  it('CASE 5b: a SOFT_CLOSED period is rejected (BR013-2)', () => {
    const r = evaluate(header, balanced, ctx({ period: { id: 'p1', code: '2026-01', status: 'SOFT_CLOSED', adjustmentsOnly: false } }));
    expect(r.pass).toBe(false);
    expect(rules(r.violations)).toContain('BR013-2');
  });
});

describe('S013 evaluate — BR013-3 source', () => {
  it('CASE 6a: an unknown source is rejected (BR013-3)', () => {
    const r = evaluate(header, balanced, ctx({ source: null }));
    expect(r.pass).toBe(false);
    expect(rules(r.violations)).toContain('BR013-3');
  });

  it('CASE 6b: an inactive source is rejected (BR013-3)', () => {
    const r = evaluate(header, balanced, ctx({ source: { code: 'GJ', sourceClass: 'MANUAL', status: 'INACTIVE' } }));
    expect(r.pass).toBe(false);
    expect(rules(r.violations)).toContain('BR013-3');
  });

  it('CASE 6c: a SYSTEM source used by a MANUAL caller is rejected (BR013-3)', () => {
    const r = evaluate(header, balanced, ctx({ source: { code: 'SVC', sourceClass: 'SYSTEM', status: 'ACTIVE' } }));
    expect(r.pass).toBe(false);
    expect(rules(r.violations)).toContain('BR013-3');
  });
});

describe('S013 evaluate — BR013-4 accounts', () => {
  it('CASE 7: an inactive account is rejected (BR013-4)', () => {
    const r = evaluate(header, [
      { accountId: INACTIVE.id, storeId: '01', dr: 100 },
      { accountId: REV.id, storeId: '01', deptCode: 'SVC', cr: 100 },
    ], ctx());
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'BR013-4' && v.lineIndex === 0)).toBe(true);
  });

  it('CASE 8: a non-postable summary account is rejected (BR013-4/BR210-5)', () => {
    const r = evaluate(header, [
      { accountId: SUMMARY.id, storeId: '01', dr: 100 },
      { accountId: REV.id, storeId: '01', deptCode: 'SVC', cr: 100 },
    ], ctx());
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'BR013-4' && v.lineIndex === 0)).toBe(true);
  });

  it('an unknown account id is rejected (BR013-4)', () => {
    const r = evaluate(header, [
      { accountId: 'nope', storeId: '01', dr: 100 },
      { accountId: REV.id, storeId: '01', deptCode: 'SVC', cr: 100 },
    ], ctx());
    expect(r.pass).toBe(false);
    expect(rules(r.violations)).toContain('BR013-4');
  });
});

describe('S013 evaluate — BR013-5 dimensions', () => {
  it('CASE 9: a P&L line missing a department is rejected (BR013-5)', () => {
    const r = evaluate(header, [
      { accountId: CASH.id, storeId: '01', dr: 100 },
      { accountId: REV.id, storeId: '01', cr: 100 }, // revenue, no dept
    ], ctx());
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'BR013-5' && v.field === 'deptCode')).toBe(true);
  });

  it('CASE 10: a line missing a store dimension is rejected (BR013-5)', () => {
    const r = evaluate(header, [
      { accountId: CASH.id, storeId: '', dr: 100 },
      { accountId: REV.id, storeId: '01', deptCode: 'SVC', cr: 100 },
    ], ctx());
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.rule === 'BR013-5' && v.field === 'storeId')).toBe(true);
  });
});

describe('S013 evaluate — BR013-6 idempotency key present', () => {
  it('a missing idempotencyKey is rejected (BR013-6)', () => {
    const r = evaluate({ ...header, idempotencyKey: '' }, balanced, ctx());
    expect(r.pass).toBe(false);
    expect(rules(r.violations)).toContain('BR013-6');
  });
});

describe('S013 evaluate — determinism (rebuild-equivalence)', () => {
  it('the same inputs produce identical violations on repeated evaluation', () => {
    const a = evaluate(header, balanced, ctx());
    const b = evaluate(header, balanced, ctx());
    expect(a).toEqual(b);
  });
});

describe('S013 balanceDelta — normal-balance signing', () => {
  it('DR-normal account increases with debits', () => {
    expect(balanceDelta('DR', toCents(100), toCents(0))).toBe(100);
    expect(balanceDelta('DR', toCents(0), toCents(40))).toBe(-40);
  });
  it('CR-normal account increases with credits', () => {
    expect(balanceDelta('CR', toCents(0), toCents(100))).toBe(100);
    expect(balanceDelta('CR', toCents(30), toCents(0))).toBe(-30);
  });
});

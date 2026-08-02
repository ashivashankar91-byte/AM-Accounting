// S054B — pure domain-rule unit tests for the rule-based auto-match
// engine. No I/O, no database.
import { describe, it, expect } from 'vitest';
import { ruleMatchesPair, decideAutoMatchAction, isValidRuleType, isValidConfidenceTier, type MatchRuleLike } from '../src/domain/auto-match-rules';

function line(overrides: Partial<any> = {}) {
  return { id: 'line-1', lineDate: new Date('2026-08-05'), description: 'Deposit ABC123', externalRef: null, amount: '100.00', ...overrides };
}
function item(overrides: Partial<any> = {}) {
  return { id: 'item-1', itemDate: new Date('2026-08-05'), description: 'Cash deposit', sourceId: 'dep-1', amount: '100.00', ...overrides };
}
function rule(overrides: Partial<MatchRuleLike> = {}): MatchRuleLike {
  return { id: 'rule-1', ruleType: 'AMOUNT_DATE_WINDOW', tier: 'EXACT', config: {}, priority: 100, ...overrides };
}

describe('auto-match-rules domain', () => {
  it('isValidRuleType / isValidConfidenceTier accept exactly the documented values', () => {
    for (const t of ['AMOUNT_DATE_WINDOW', 'REFERENCE_CONTAINS', 'CHECK_NUMBER', 'BATCH_TOTAL']) expect(isValidRuleType(t)).toBe(true);
    expect(isValidRuleType('BOGUS')).toBe(false);
    expect(isValidConfidenceTier('EXACT')).toBe(true);
    expect(isValidConfidenceTier('SUGGESTED')).toBe(true);
    expect(isValidConfidenceTier('BOGUS')).toBe(false);
  });

  describe('AMOUNT_DATE_WINDOW', () => {
    it('matches within amount tolerance and date window', () => {
      const r = rule({ ruleType: 'AMOUNT_DATE_WINDOW', config: { amountToleranceCents: 100, dateWindowDays: 2 } });
      expect(ruleMatchesPair(r, line({ amount: '100.50' }), item({ amount: '100.00', itemDate: new Date('2026-08-06') }))).toBe(true);
    });
    it('does not match outside the amount tolerance', () => {
      const r = rule({ ruleType: 'AMOUNT_DATE_WINDOW', config: { amountToleranceCents: 100, dateWindowDays: 2 } });
      expect(ruleMatchesPair(r, line({ amount: '105.00' }), item({ amount: '100.00' }))).toBe(false);
    });
    it('does not match outside the date window', () => {
      const r = rule({ ruleType: 'AMOUNT_DATE_WINDOW', config: { amountToleranceCents: 0, dateWindowDays: 1 } });
      expect(ruleMatchesPair(r, line({ amount: '100.00' }), item({ amount: '100.00', itemDate: new Date('2026-08-10') }))).toBe(false);
    });
  });

  describe('BATCH_TOTAL', () => {
    it('matches only on exact amount and same-day (never invents a multi-item sum)', () => {
      const r = rule({ ruleType: 'BATCH_TOTAL', config: {} });
      expect(ruleMatchesPair(r, line({ amount: '500.00' }), item({ amount: '500.00' }))).toBe(true);
      expect(ruleMatchesPair(r, line({ amount: '500.00' }), item({ amount: '500.00', itemDate: new Date('2026-08-06') }))).toBe(false);
      expect(ruleMatchesPair(r, line({ amount: '500.01' }), item({ amount: '500.00' }))).toBe(false);
    });
  });

  describe('REFERENCE_CONTAINS', () => {
    it('matches when the statement line reference/description contains the book item sourceId', () => {
      const r = rule({ ruleType: 'REFERENCE_CONTAINS', config: {} });
      expect(ruleMatchesPair(r, line({ externalRef: 'ref-dep-1-confirm' }), item({ sourceId: 'dep-1' }))).toBe(true);
      expect(ruleMatchesPair(r, line({ externalRef: 'unrelated' }), item({ sourceId: 'dep-1' }))).toBe(false);
    });
    it('never matches when the book item has no sourceId (manual entries)', () => {
      const r = rule({ ruleType: 'REFERENCE_CONTAINS', config: {} });
      expect(ruleMatchesPair(r, line({ externalRef: 'anything' }), item({ sourceId: null }))).toBe(false);
    });
  });

  describe('CHECK_NUMBER', () => {
    it('matches only on an exact externalRef == sourceId string match', () => {
      const r = rule({ ruleType: 'CHECK_NUMBER', config: {} });
      expect(ruleMatchesPair(r, line({ externalRef: 'CHK-1001' }), item({ sourceId: 'CHK-1001' }))).toBe(true);
      expect(ruleMatchesPair(r, line({ externalRef: 'CHK-1001' }), item({ sourceId: 'CHK-1002' }))).toBe(false);
      expect(ruleMatchesPair(r, line({ externalRef: null }), item({ sourceId: 'CHK-1001' }))).toBe(false);
    });
  });

  describe('decideAutoMatchAction', () => {
    it('AC: an EXACT-tier rule with exactly one candidate auto-clears', () => {
      const decision = decideAutoMatchAction(rule({ tier: 'EXACT' }), [item()]);
      expect(decision.action).toBe('AUTO_CLEAR');
    });
    it('AC: an EXACT-tier rule with zero candidates does nothing', () => {
      const decision = decideAutoMatchAction(rule({ tier: 'EXACT' }), []);
      expect(decision.action).toBe('NONE');
    });
    it('AC: an EXACT-tier rule with MULTIPLE (ambiguous) candidates is downgraded to a suggestion — never auto-cleared', () => {
      const decision = decideAutoMatchAction(rule({ tier: 'EXACT' }), [item({ id: 'a' }), item({ id: 'b' })]);
      expect(decision.action).toBe('SUGGEST');
      if (decision.action === 'SUGGEST') expect(decision.items).toHaveLength(2);
    });
    it('AC: a SUGGESTED-tier rule never auto-clears, even with exactly one candidate', () => {
      const decision = decideAutoMatchAction(rule({ tier: 'SUGGESTED' }), [item()]);
      expect(decision.action).toBe('SUGGEST');
    });
  });
});

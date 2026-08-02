import { describe, it, expect } from 'vitest';
import { runScrubRules, DEFAULT_RULES } from '../../src/domain/scrub-engine';

describe('scrub-engine', () => {
  it('returns no findings when all context is clean', () => {
    const findings = runScrubRules(DEFAULT_RULES, { unpostedJournals: 0, unreconciledAccounts: 0, missingEvidence: 0, staleRates: false, openFindings: 0 });
    expect(findings).toHaveLength(0);
  });

  it('returns ERROR finding for unposted journals', () => {
    const findings = runScrubRules(DEFAULT_RULES, { unpostedJournals: 3, unreconciledAccounts: 0, missingEvidence: 0, staleRates: false, openFindings: 0 });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleCode).toBe('UNPOSTED_JOURNALS');
    expect(findings[0].severity).toBe('ERROR');
  });

  it('returns WARNING for stale rates', () => {
    const findings = runScrubRules(DEFAULT_RULES, { unpostedJournals: 0, unreconciledAccounts: 0, missingEvidence: 0, staleRates: true, openFindings: 0 });
    const staleRatesFinding = findings.find(f => f.ruleCode === 'STALE_RATES');
    expect(staleRatesFinding).toBeDefined();
    expect(staleRatesFinding?.severity).toBe('WARNING');
  });

  it('returns multiple findings for multiple issues', () => {
    const findings = runScrubRules(DEFAULT_RULES, { unpostedJournals: 1, unreconciledAccounts: 2, missingEvidence: 0, staleRates: false, openFindings: 0 });
    expect(findings.length).toBeGreaterThanOrEqual(2);
  });
});

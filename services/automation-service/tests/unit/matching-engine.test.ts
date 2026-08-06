/**
 * S058 and S101B share one discipline: every deterministic rule runs first and
 * its answer is final; only the residue is allowed anywhere near a score. These
 * tests pin that ordering down, along with the two refusals that keep it
 * honest — ambiguity is not a match, and a scored result is a suggestion.
 */

import { describe, it, expect } from 'vitest';
import { matchExactKey, scoreResidual, matchAll, MatchCandidate, MatchSubject } from '../../src/domain/matching-engine';

const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: 'c1', amount: '100.00', reference: null, documentNumber: 'INV-1001', partyRef: 'CUST-1', ...over,
});

const subject = (over: Partial<MatchSubject> = {}): MatchSubject => ({
  id: 's1', amount: '100.00', applyNumber: 'INV-1001', remittanceRef: null, partyRef: 'CUST-1', ...over,
});

describe('deterministic exact-key matching', () => {
  it('matches on document key plus exact amount and attaches no score', () => {
    const out = matchExactKey(subject(), [candidate()]);
    expect(out).not.toBeNull();
    expect(out!.matchType).toBe('EXACT_KEY');
    expect(out!.score).toBeNull();
    expect(out!.candidateId).toBe('c1');
  });

  it('normalises punctuation and case, so "inv 1001" and "INV-1001" are the same key', () => {
    const out = matchExactKey(subject({ applyNumber: 'inv 1001' }), [candidate({ documentNumber: 'INV-1001' })]);
    expect(out?.matchType).toBe('EXACT_KEY');
  });

  it('refuses to match when the amount differs, however good the key is', () => {
    expect(matchExactKey(subject({ amount: '100.01' }), [candidate()])).toBeNull();
  });

  it('treats two candidates with the same key and amount as ambiguity, not a match', () => {
    const out = matchExactKey(subject(), [candidate({ id: 'c1' }), candidate({ id: 'c2' })]);
    expect(out).toBeNull();
  });

  it('returns null when the subject carries no key at all', () => {
    expect(matchExactKey(subject({ applyNumber: null, remittanceRef: null }), [candidate()])).toBeNull();
  });

  it('matches on the remittance reference when there is no apply number', () => {
    const out = matchExactKey(
      subject({ applyNumber: null, remittanceRef: 'REF-77' }),
      [candidate({ documentNumber: null, reference: 'REF-77' })],
    );
    expect(out?.matchType).toBe('EXACT_KEY');
  });
});

describe('residual scoring', () => {
  it('scores an exact amount plus exact key highest and explains every component', () => {
    const out = scoreResidual(subject(), [candidate()]);
    expect(out.matchType).toBe('SCORED');
    expect(Number(out.score)).toBeCloseTo(1.0, 4);
    expect(out.rationale).toContain('amount exact (+0.50)');
    expect(out.rationale).toContain('document key exact (+0.30)');
    expect(out.rationale).toContain('party exact (+0.20)');
  });

  it('says out loud that it only ran because no deterministic rule matched', () => {
    expect(scoreResidual(subject(), [candidate()]).rationale).toContain('no deterministic rule matched');
  });

  it('leaves a weak candidate unmatched rather than suggesting it', () => {
    const out = scoreResidual(
      subject({ applyNumber: 'ZZZ', partyRef: 'OTHER' }),
      [candidate({ amount: '500.00', documentNumber: 'AAA', partyRef: 'CUST-9' })],
    );
    expect(out.matchType).toBe('UNMATCHED');
    expect(out.candidateId).toBeNull();
  });

  it('reports the best sub-threshold score so a reviewer can see how close it got', () => {
    const out = scoreResidual(
      subject({ applyNumber: 'ZZZ', partyRef: null }),
      [candidate({ amount: '101.00', documentNumber: 'AAA', partyRef: null })],
    );
    expect(out.matchType).toBe('UNMATCHED');
    expect(Number(out.score)).toBeGreaterThan(0);
    expect(out.rationale).toContain('below the 0.5000 suggestion floor');
  });

  it('returns a null score when nothing scored at all', () => {
    const out = scoreResidual(subject({ applyNumber: 'ZZZ', partyRef: null }), []);
    expect(out.matchType).toBe('UNMATCHED');
    expect(out.score).toBeNull();
  });

  it('is deterministic: the same inputs always produce the same score', () => {
    const a = scoreResidual(subject(), [candidate()]);
    const b = scoreResidual(subject(), [candidate()]);
    expect(a).toEqual(b);
  });

  it('reports scores to four decimal places, matching the stored precision', () => {
    const out = scoreResidual(subject(), [candidate()]);
    expect(out.score).toMatch(/^\d\.\d{4}$/);
  });
});

describe('matchAll ordering', () => {
  it('runs every deterministic rule before any scoring', () => {
    const subjects = [
      subject({ id: 's-fuzzy', applyNumber: 'INV-2001', amount: '100.00', partyRef: 'CUST-1' }),
      subject({ id: 's-exact', applyNumber: 'INV-1001', amount: '100.00', partyRef: 'CUST-1' }),
    ];
    const candidates = [candidate({ id: 'c-exact', documentNumber: 'INV-1001', amount: '100.00' })];

    const outcomes = matchAll(subjects, candidates);
    const exact = outcomes.find((o) => o.subjectId === 's-exact')!;
    const fuzzy = outcomes.find((o) => o.subjectId === 's-fuzzy')!;

    // The exact-key subject claimed the only candidate, even though it was
    // declared second and the fuzzy subject would also have scored on it.
    expect(exact.matchType).toBe('EXACT_KEY');
    expect(exact.candidateId).toBe('c-exact');
    expect(fuzzy.matchType).toBe('UNMATCHED');
  });

  it('never assigns one candidate to two subjects', () => {
    const subjects = [subject({ id: 's1' }), subject({ id: 's2' })];
    const outcomes = matchAll(subjects, [candidate({ id: 'c1' })]);
    const claimed = outcomes.map((o) => o.candidateId).filter(Boolean);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('returns exactly one outcome per subject, including the unmatched ones', () => {
    const subjects = [subject({ id: 's1' }), subject({ id: 's2', applyNumber: 'NOPE', partyRef: null, amount: '9.99' })];
    const outcomes = matchAll(subjects, [candidate()]);
    expect(outcomes.map((o) => o.subjectId).sort()).toEqual(['s1', 's2']);
  });

  it('handles an empty candidate set by reporting everything unmatched', () => {
    const outcomes = matchAll([subject()], []);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.matchType).toBe('UNMATCHED');
  });
});

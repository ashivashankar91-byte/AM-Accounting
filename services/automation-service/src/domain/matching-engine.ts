/**
 * CE-17 — Deterministic matching.
 *
 * Both S058 (lockbox) and S101B (OEM statements) obey the same discipline: run
 * every deterministic rule first and take its answer as final; only what is
 * left over is allowed anywhere near a score. A scored suggestion is a
 * suggestion — it never auto-executes, and it never overrides an exact key.
 */

export interface MatchCandidate {
  id: string;
  amount: string;
  reference: string | null;
  documentNumber: string | null;
  partyRef?: string | null;
}

export interface MatchSubject {
  id: string;
  amount: string;
  applyNumber: string | null;
  remittanceRef: string | null;
  partyRef?: string | null;
}

export type MatchType = 'EXACT_KEY' | 'SCORED' | 'UNMATCHED';

export interface MatchOutcome {
  subjectId: string;
  matchType: MatchType;
  candidateId: string | null;
  score: string | null;
  rationale: string;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function amountsEqual(a: string, b: string): boolean {
  return Number(a).toFixed(2) === Number(b).toFixed(2);
}

/**
 * Stage 1 — deterministic. An exact document/apply key plus an exact amount is
 * a match by rule, with no score attached, because there is nothing uncertain
 * about it.
 */
export function matchExactKey(subject: MatchSubject, candidates: MatchCandidate[]): MatchOutcome | null {
  const subjectKeys = [normalize(subject.applyNumber), normalize(subject.remittanceRef)].filter(Boolean);
  if (subjectKeys.length === 0) return null;

  const exact = candidates.filter((c) => {
    const candidateKeys = [normalize(c.documentNumber), normalize(c.reference)].filter(Boolean);
    return candidateKeys.some((k) => subjectKeys.includes(k)) && amountsEqual(subject.amount, c.amount);
  });

  // Two candidates carrying the same key and amount is ambiguity, not a match.
  if (exact.length !== 1) return null;

  return {
    subjectId: subject.id,
    matchType: 'EXACT_KEY',
    candidateId: exact[0]!.id,
    score: null,
    rationale: `Deterministic rule: document key and amount ${Number(subject.amount).toFixed(2)} matched exactly on a single candidate.`,
  };
}

/**
 * Stage 2 — residual scoring. Only reached for subjects no deterministic rule
 * claimed. Components are fixed and additive so the same inputs always produce
 * the same score, and the score is reported rather than acted upon.
 */
export function scoreResidual(subject: MatchSubject, candidates: MatchCandidate[]): MatchOutcome {
  let best: { candidate: MatchCandidate; score: number; parts: string[] } | null = null;

  for (const candidate of candidates) {
    let score = 0;
    const parts: string[] = [];

    if (amountsEqual(subject.amount, candidate.amount)) { score += 0.5; parts.push('amount exact (+0.50)'); }
    else {
      const s = Math.abs(Number(subject.amount));
      const c = Math.abs(Number(candidate.amount));
      const denom = Math.max(s, c, 0.01);
      const closeness = 1 - Math.abs(s - c) / denom;
      if (closeness > 0.95) { score += 0.2; parts.push('amount within 5% (+0.20)'); }
    }

    const sKeys = [normalize(subject.applyNumber), normalize(subject.remittanceRef)].filter(Boolean);
    const cKeys = [normalize(candidate.documentNumber), normalize(candidate.reference)].filter(Boolean);
    if (sKeys.some((k) => cKeys.includes(k))) { score += 0.3; parts.push('document key exact (+0.30)'); }
    else if (sKeys.some((k) => cKeys.some((ck) => ck.includes(k) || k.includes(ck)))) { score += 0.15; parts.push('document key partial (+0.15)'); }

    if (subject.partyRef && candidate.partyRef && normalize(subject.partyRef) === normalize(candidate.partyRef)) {
      score += 0.2; parts.push('party exact (+0.20)');
    }

    if (score > 0 && (!best || score > best.score)) best = { candidate, score, parts };
  }

  if (!best || best.score < 0.5) {
    return {
      subjectId: subject.id,
      matchType: 'UNMATCHED',
      candidateId: null,
      score: best ? best.score.toFixed(4) : null,
      rationale: best
        ? `No deterministic rule matched and the best residual score ${best.score.toFixed(4)} is below the 0.5000 suggestion floor.`
        : 'No deterministic rule matched and no candidate scored above zero.',
    };
  }

  return {
    subjectId: subject.id,
    matchType: 'SCORED',
    candidateId: best.candidate.id,
    score: best.score.toFixed(4),
    rationale: `Residual scoring only (no deterministic rule matched): ${best.parts.join(', ')}.`,
  };
}

/** Deterministic first, scored second — never the other way round. */
export function matchAll(subjects: MatchSubject[], candidates: MatchCandidate[]): MatchOutcome[] {
  const claimed = new Set<string>();
  const outcomes: MatchOutcome[] = [];

  for (const subject of subjects) {
    const exact = matchExactKey(subject, candidates.filter((c) => !claimed.has(c.id)));
    if (exact) {
      claimed.add(exact.candidateId!);
      outcomes.push(exact);
    }
  }

  for (const subject of subjects) {
    if (outcomes.some((o) => o.subjectId === subject.id)) continue;
    const outcome = scoreResidual(subject, candidates.filter((c) => !claimed.has(c.id)));
    if (outcome.candidateId) claimed.add(outcome.candidateId);
    outcomes.push(outcome);
  }

  return outcomes.sort((a, b) => a.subjectId.localeCompare(b.subjectId));
}

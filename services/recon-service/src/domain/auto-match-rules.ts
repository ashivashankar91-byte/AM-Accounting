// S054B — Rule-Based Bank Auto-Match domain rules. Pure functions; no I/O.
// Tenant-configurable rules classify unmatched statement lines against
// outstanding book items within a single reconciliation session (so
// cross-account/entity clearing is structurally impossible — matching
// only ever operates within one session's own lines/items). Every rule
// has a fixed confidence tier (EXACT or SUGGESTED) set by tenant config;
// EXACT rules only auto-clear when they identify exactly one unambiguous
// candidate — an EXACT rule matching more than one candidate is treated
// as ambiguous and downgraded to a suggestion, never auto-cleared.

export type RuleType = 'AMOUNT_DATE_WINDOW' | 'REFERENCE_CONTAINS' | 'CHECK_NUMBER' | 'BATCH_TOTAL';
export type ConfidenceTier = 'EXACT' | 'SUGGESTED';
export type SuggestionStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export function isValidRuleType(t: string): t is RuleType {
  return t === 'AMOUNT_DATE_WINDOW' || t === 'REFERENCE_CONTAINS' || t === 'CHECK_NUMBER' || t === 'BATCH_TOTAL';
}

export function isValidConfidenceTier(t: string): t is ConfidenceTier {
  return t === 'EXACT' || t === 'SUGGESTED';
}

export interface RuleConfig {
  amountToleranceCents?: number;
  dateWindowDays?: number;
}

export interface MatchRuleLike {
  id: string;
  ruleType: string;
  tier: string;
  config: RuleConfig;
  priority: number;
}

export interface StatementLineLike {
  id: string;
  lineDate: Date;
  description: string;
  externalRef: string | null;
  amount: string | number;
}

export interface BookItemLike {
  id: string;
  itemDate: Date;
  description: string;
  sourceId: string | null;
  amount: string | number;
}

function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Evaluates a single rule against a single (statementLine, bookItem) pair.
 * Returns true if this pair is a candidate under this rule's criteria —
 * tier-agnostic; tier is a fixed property of the rule (tenant config), not
 * computed here.
 *
 * BATCH_TOTAL is implemented as an exact-amount, same-day match: in this
 * system a DEPOSIT (or FEE) book item already represents an aggregated
 * batch total sourced from cash-service (a deposit batch / settlement
 * batch), so "matching a statement line against a batch total" reduces to
 * matching the statement line's amount against that single aggregate book
 * item's amount with no date tolerance — never an invented multi-item sum.
 */
export function ruleMatchesPair(rule: MatchRuleLike, line: StatementLineLike, item: BookItemLike): boolean {
  switch (rule.ruleType) {
    case 'AMOUNT_DATE_WINDOW': {
      const amountTolerance = rule.config.amountToleranceCents ?? 0;
      const dateWindow = rule.config.dateWindowDays ?? 0;
      const amountDiff = Math.abs(toCents(line.amount) - toCents(item.amount));
      return amountDiff <= amountTolerance && daysBetween(line.lineDate, item.itemDate) <= dateWindow;
    }
    case 'BATCH_TOTAL': {
      return toCents(line.amount) === toCents(item.amount) && daysBetween(line.lineDate, item.itemDate) === 0;
    }
    case 'REFERENCE_CONTAINS': {
      if (!item.sourceId) return false;
      const ref = (line.externalRef ?? line.description ?? '').toLowerCase();
      return ref.length > 0 && ref.includes(item.sourceId.toLowerCase());
    }
    case 'CHECK_NUMBER': {
      if (!line.externalRef || !item.sourceId) return false;
      return line.externalRef === item.sourceId;
    }
    default:
      return false;
  }
}

export type AutoMatchDecision =
  | { action: 'AUTO_CLEAR'; item: BookItemLike }
  | { action: 'SUGGEST'; items: BookItemLike[] }
  | { action: 'NONE' };

/**
 * AC: the auto-cleared set is 100% rule-attributed, and ambiguous
 * candidates become suggestions only, never auto-cleared. An EXACT-tier
 * rule only produces AUTO_CLEAR when it finds exactly one candidate; zero
 * or multiple candidates (ambiguous) always fall through to SUGGEST (or
 * NONE for zero). A SUGGESTED-tier rule never auto-clears, regardless of
 * candidate count.
 */
export function decideAutoMatchAction(rule: MatchRuleLike, candidates: BookItemLike[]): AutoMatchDecision {
  if (candidates.length === 0) return { action: 'NONE' };
  if (rule.tier === 'EXACT' && candidates.length === 1) return { action: 'AUTO_CLEAR', item: candidates[0] };
  return { action: 'SUGGEST', items: candidates };
}

export class MatchRuleInputError extends Error {
  readonly status = 400;
  readonly code = 'MATCH_RULE_INPUT_ERROR';
}

export class MatchRuleNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'MATCH_RULE_NOT_FOUND';
}

export class SuggestionNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'RECON_SUGGESTION_NOT_FOUND';
}

export class SuggestionNotPendingError extends Error {
  readonly status = 409;
  readonly code = 'RECON_SUGGESTION_NOT_PENDING';
  constructor(message = 'Suggestion is not PENDING (already confirmed or rejected)') {
    super(message);
    this.name = 'SuggestionNotPendingError';
  }
}

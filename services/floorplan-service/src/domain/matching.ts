// CE-12 (S080) — pure VIN/stock# matching classification logic. No DB, no
// network — self-sufficient by design (this service does not call
// vehicle-accounting-service synchronously to validate a VIN is a "real"
// unit; see application/match-service.ts for the
// PENDING_UPSTREAM_TECHNICAL_RECONCILIATION note on that boundary).
import { FloorplanValidationError } from './errors';

export interface StagedRowForMatch {
  rowType: 'ADVANCE' | 'PAYOFF';
  amount: string;
}

export interface ExistingLiabilityItem {
  status: 'OPEN' | 'PARTIALLY_RELIEVED' | 'RELIEVED';
  remainingBalance: string;
}

export type MatchOutcome =
  | { kind: 'MATCH_ADVANCE' }
  | { kind: 'MATCH_PAYOFF'; relievesFully: boolean }
  | { kind: 'BREAK_LENDER_HAS_WE_DONT' }
  | { kind: 'BREAK_AMOUNT_VARIANCE'; varianceAmount: string };

function toCents(amount: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n)) throw new FloorplanValidationError(`Invalid decimal amount: ${amount}`);
  return Math.round(n * 100);
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Classifies a single staged lender row against the current state (if any)
 * of the unit's own floorplan liability item. Deterministic, side-effect
 * free — application/match-service.ts is responsible for turning this
 * classification into DB writes + a posting-engine submission.
 */
export function classifyStagedRow(row: StagedRowForMatch, existingItem: ExistingLiabilityItem | null): MatchOutcome {
  if (row.rowType === 'ADVANCE') {
    // A new advance always matches: either it opens a brand-new item, or it
    // tops up an item that's still open/partially relieved, or it re-floors
    // a previously fully-relieved item (unit re-financed) — none of these
    // are breaks; they are all ordinary floorplan lifecycle events.
    return { kind: 'MATCH_ADVANCE' };
  }

  // PAYOFF
  if (!existingItem) {
    // The lender recorded a payoff for a unit we have no liability record
    // for at all — a genuine break (lender-has/we-don't).
    return { kind: 'BREAK_LENDER_HAS_WE_DONT' };
  }

  const payoffCents = toCents(row.amount);
  const remainingCents = toCents(existingItem.remainingBalance);

  if (payoffCents > remainingCents) {
    return { kind: 'BREAK_AMOUNT_VARIANCE', varianceAmount: fromCents(payoffCents - remainingCents) };
  }

  return { kind: 'MATCH_PAYOFF', relievesFully: payoffCents === remainingCents };
}

export interface OpenItemForReconciliation {
  applyNumber: string;
  vin: string | null;
  stockNumber: string | null;
}

/**
 * S080 break worklist, "we-have/lender-doesn't" category: our own OPEN/
 * PARTIALLY_RELIEVED liability items whose applyNumber does not appear
 * anywhere in the lender's most recent statement batch (the full set of
 * applyNumbers referenced by staged rows from that batch). Pure set
 * comparison — the caller supplies both sides.
 */
export function findWeHaveLenderDoesntBreaks(
  ourOpenItems: OpenItemForReconciliation[],
  lenderApplyNumbersInLatestBatch: Set<string>,
): OpenItemForReconciliation[] {
  return ourOpenItems.filter((item) => !lenderApplyNumbersInLatestBatch.has(item.applyNumber));
}

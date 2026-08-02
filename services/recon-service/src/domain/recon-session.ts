// S054A — Manual Bank Reconciliation Workbench domain rules. Pure
// functions; no I/O. A reconciliation session is per bank-account +
// statement period. Statement lines (bank-side) and book items (book-side:
// payments, deposits, fees, NSF, sweeps) are matched/cleared against each
// other; completion is gated by a conservation check and is a one-way lock
// — no cleared line is ever deleted, only unmatched before completion.

export type ReconSessionStatus = 'OPEN' | 'COMPLETED';
export type StatementLineSource = 'MANUAL' | 'IMPORTED';
export type StatementLineStatus = 'UNMATCHED' | 'CLEARED';
export type BookItemStatus = 'OUTSTANDING' | 'CLEARED';
export type BookItemType = 'PAYMENT' | 'DEPOSIT' | 'FEE' | 'NSF' | 'SWEEP';
export type BookItemSourceService = 'CASH_SERVICE' | 'APAR_SERVICE' | 'MANUAL';

export function isValidBookItemType(t: string): t is BookItemType {
  return t === 'PAYMENT' || t === 'DEPOSIT' || t === 'FEE' || t === 'NSF' || t === 'SWEEP';
}

export function isValidStatementLineSource(s: string): s is StatementLineSource {
  return s === 'MANUAL' || s === 'IMPORTED';
}

export function canAddLine(sessionStatus: string): boolean {
  return sessionStatus === 'OPEN';
}

export function canMatch(sessionStatus: string): boolean {
  return sessionStatus === 'OPEN';
}

export function canUnmatch(sessionStatus: string): boolean {
  return sessionStatus === 'OPEN';
}

export function canComplete(sessionStatus: string): boolean {
  return sessionStatus === 'OPEN';
}

function toCents(amount: string | number): number {
  return Math.round(Number(amount) * 100);
}

/**
 * AC: completion must be refused when out of balance, with a named
 * refusal. Literal formula per the S054A spec: cleared book total +
 * outstanding items total = statement ending balance. Every book item
 * relevant to the session must be accounted for (either cleared against a
 * statement line, or still outstanding) for this to hold — the split
 * between cleared/outstanding is for matching traceability, not for the
 * sum itself.
 */
export function checkConservation(
  clearedBookTotal: Array<string | number>,
  outstandingItemsTotal: Array<string | number>,
  statementEndingBalance: string | number,
): void {
  const clearedCents = clearedBookTotal.reduce((acc: number, a) => acc + toCents(a), 0);
  const outstandingCents = outstandingItemsTotal.reduce((acc: number, a) => acc + toCents(a), 0);
  const statementCents = toCents(statementEndingBalance);
  if (clearedCents + outstandingCents !== statementCents) {
    throw new ReconOutOfBalanceError(clearedCents, outstandingCents, statementCents);
  }
}

export class ReconInputError extends Error {
  readonly status = 400;
  readonly code = 'RECON_INPUT_ERROR';
}

export class ReconSessionNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'RECON_SESSION_NOT_FOUND';
}

export class ReconStatementLineNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'RECON_STATEMENT_LINE_NOT_FOUND';
}

export class ReconBookItemNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'RECON_BOOK_ITEM_NOT_FOUND';
}

export class ReconSessionNotOpenError extends Error {
  readonly status = 409;
  readonly code = 'RECON_SESSION_NOT_OPEN';
  constructor(message = 'Reconciliation session is not OPEN (must be OPEN to add lines, match, unmatch, or complete)') {
    super(message);
    this.name = 'ReconSessionNotOpenError';
  }
}

export class ReconAlreadyClearedError extends Error {
  readonly status = 409;
  readonly code = 'RECON_ALREADY_CLEARED';
  constructor(message = 'Statement line or book item is already CLEARED') {
    super(message);
    this.name = 'ReconAlreadyClearedError';
  }
}

export class ReconNotClearedError extends Error {
  readonly status = 409;
  readonly code = 'RECON_NOT_CLEARED';
  constructor(message = 'Statement line is not CLEARED, so it cannot be unmatched') {
    super(message);
    this.name = 'ReconNotClearedError';
  }
}

/**
 * Named refusal for the conservation-check gate — completion is REFUSED,
 * never silently forced, whenever cleared + outstanding book totals do not
 * exactly equal the statement ending balance.
 */
export class ReconOutOfBalanceError extends Error {
  readonly status = 409;
  readonly code = 'RECON_OUT_OF_BALANCE';
  constructor(readonly clearedCents: number, readonly outstandingCents: number, readonly statementCents: number) {
    super(
      `Reconciliation session refused completion: cleared book total (${clearedCents} cents) + outstanding items ` +
      `(${outstandingCents} cents) = ${clearedCents + outstandingCents} cents, but the statement ending balance is ` +
      `${statementCents} cents`,
    );
    this.name = 'ReconOutOfBalanceError';
  }
}

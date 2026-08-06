/**
 * CE-16 — Control totals & debit/credit conservation.
 *
 * Control totals are captured at every phase boundary (EXTRACT → STAGING →
 * TRANSFORM → LOAD) so a run can prove nothing was silently gained or lost
 * between phases. Conservation is checked to the cent; no financial batch may
 * be promoted while out of balance.
 *
 * Pure module — no I/O, no clock reads.
 */

export type ControlPhase = 'EXTRACT' | 'STAGING' | 'TRANSFORM' | 'LOAD';

export interface FinancialLine {
  debit?: number;
  credit?: number;
}

export interface ControlTotalSnapshot {
  phase: ControlPhase;
  rowCount: number;
  acceptedCount: number;
  rejectedCount: number;
  totalDebit: number;
  totalCredit: number;
  openItemTotal: number;
  scheduleBalance: number;
  documentCount: number;
  exceptionCount: number;
  duplicateCount: number;
}

export interface ConservationResult {
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
  delta: number;
  lineCount: number;
}

export class UnbalancedConversionBatchError extends Error {
  readonly code = 'STRUCTURAL_IMBALANCE';
  constructor(public readonly result: ConservationResult) {
    super(
      `Conversion batch is out of balance: debits ${result.totalDebit.toFixed(2)} vs credits ${result.totalCredit.toFixed(2)} (delta ${result.delta.toFixed(2)})`,
    );
    this.name = 'UnbalancedConversionBatchError';
  }
}

const CENT = 0.005;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sumDebitsCredits(lines: FinancialLine[]): ConservationResult {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    totalDebit = round2(totalDebit + (line.debit ?? 0));
    totalCredit = round2(totalCredit + (line.credit ?? 0));
  }
  const delta = round2(totalDebit - totalCredit);
  return { balanced: Math.abs(delta) <= CENT, totalDebit, totalCredit, delta, lineCount: lines.length };
}

/** Throws unless the batch conserves debits and credits exactly. */
export function assertConserved(lines: FinancialLine[]): ConservationResult {
  const result = sumDebitsCredits(lines);
  if (!result.balanced) throw new UnbalancedConversionBatchError(result);
  return result;
}

export interface PhaseComparison {
  fromPhase: ControlPhase;
  toPhase: ControlPhase;
  reconciled: boolean;
  discrepancies: { metric: string; from: number; to: number; delta: number }[];
}

/**
 * Compares two phase snapshots. Rows may legitimately be rejected between
 * phases, so row counts reconcile as `accepted(to) + rejected(to) <= rows(from)`
 * while monetary totals must move only by the value of rejected rows — which is
 * why accepted monetary totals are compared directly and any difference is
 * surfaced rather than absorbed.
 */
export function comparePhases(from: ControlTotalSnapshot, to: ControlTotalSnapshot): PhaseComparison {
  const discrepancies: { metric: string; from: number; to: number; delta: number }[] = [];

  const accountedFor = to.acceptedCount + to.rejectedCount;
  if (accountedFor !== from.rowCount) {
    discrepancies.push({ metric: 'rowCount', from: from.rowCount, to: accountedFor, delta: accountedFor - from.rowCount });
  }

  for (const metric of ['totalDebit', 'totalCredit', 'openItemTotal', 'scheduleBalance'] as const) {
    const a = round2(from[metric]);
    const b = round2(to[metric]);
    const delta = round2(b - a);
    if (Math.abs(delta) > CENT) discrepancies.push({ metric, from: a, to: b, delta });
  }

  return { fromPhase: from.phase, toPhase: to.phase, reconciled: discrepancies.length === 0, discrepancies };
}

export interface StagedRowLike {
  stagedData: Record<string, unknown>;
  state?: string;
  validationErrors?: unknown[];
}

/** Builds a phase snapshot from staged rows; the single place row→total math lives. */
export function computeControlTotals(phase: ControlPhase, rows: StagedRowLike[]): ControlTotalSnapshot {
  let totalDebit = 0;
  let totalCredit = 0;
  let openItemTotal = 0;
  let accepted = 0;
  let rejected = 0;
  const documents = new Set<string>();

  for (const row of rows) {
    const data = row.stagedData ?? {};
    const debit = Number(data['debit'] ?? 0);
    const credit = Number(data['credit'] ?? 0);
    const openItem = Number(data['openItemAmount'] ?? data['amount'] ?? 0);
    const documentRef = data['documentRef'];

    const hasErrors = (row.validationErrors?.length ?? 0) > 0 || row.state === 'ERROR' || row.state === 'REJECTED';
    if (hasErrors) {
      rejected += 1;
      continue;
    }
    accepted += 1;
    if (Number.isFinite(debit)) totalDebit = round2(totalDebit + debit);
    if (Number.isFinite(credit)) totalCredit = round2(totalCredit + credit);
    if (Number.isFinite(openItem)) openItemTotal = round2(openItemTotal + openItem);
    if (typeof documentRef === 'string' && documentRef) documents.add(documentRef);
  }

  return {
    phase,
    rowCount: rows.length,
    acceptedCount: accepted,
    rejectedCount: rejected,
    totalDebit,
    totalCredit,
    openItemTotal,
    scheduleBalance: openItemTotal,
    documentCount: documents.size,
    exceptionCount: rejected,
    duplicateCount: 0,
  };
}

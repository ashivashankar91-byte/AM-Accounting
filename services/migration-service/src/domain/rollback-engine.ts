/**
 * CE-16 — Rollback engine.
 *
 * Three genuinely different things are all colloquially called "rollback", and
 * conflating them is how migration evidence gets destroyed:
 *
 *   1. PRE_PROMOTION_CANCEL — nothing has been promoted; the run is abandoned.
 *      Staged data is marked cancelled (never deleted) and the run is closed.
 *
 *   2. STAGED_DATA_RESET — staged rows are discarded and re-derived from the
 *      immutable source rows. Legal only while nothing financial has been
 *      promoted, because staged rows that already produced journals are
 *      evidence of what was posted.
 *
 *   3. PROMOTED_FINANCIAL_REVERSAL — journals exist. The only lawful undo is a
 *      governed reversal entry through CE-07, carrying the ORIGINAL lineage
 *      forward. Nothing is deleted, nothing is back-dated, and the original
 *      conversion journal remains permanently visible.
 *
 * Pure module — no I/O, no clock reads.
 */

import { MigrationState, isPrePromotionState } from './migration-state-machine';

export type RollbackKind = 'PRE_PROMOTION_CANCEL' | 'STAGED_DATA_RESET' | 'PROMOTED_FINANCIAL_REVERSAL';

export class RollbackError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'RollbackError';
  }
}

export interface RollbackAssessmentInput {
  state: MigrationState;
  /** Journals already produced by this run's promotions. */
  promotedJournalRefs: string[];
  /** Open items already established by this run's promotions. */
  promotedOpenItemRefs: string[];
  requestedKind?: RollbackKind;
}

export interface RollbackPlan {
  kind: RollbackKind;
  /** Reversal entries required through the CE-07 governed posting path. */
  reversalRequired: boolean;
  journalRefsToReverse: string[];
  openItemRefsToReverse: string[];
  /** Always true — migration evidence is never deleted, only superseded. */
  preservesEvidence: true;
  rationale: string;
}

export function assessRollback(input: RollbackAssessmentInput): RollbackPlan {
  const hasFinancialEffects = input.promotedJournalRefs.length > 0 || input.promotedOpenItemRefs.length > 0;

  if (hasFinancialEffects) {
    if (input.requestedKind && input.requestedKind !== 'PROMOTED_FINANCIAL_REVERSAL') {
      throw new RollbackError(
        `Run has ${input.promotedJournalRefs.length} promoted journal(s); only PROMOTED_FINANCIAL_REVERSAL is lawful`,
        'FINANCIAL_EFFECTS_REQUIRE_REVERSAL',
      );
    }
    return {
      kind: 'PROMOTED_FINANCIAL_REVERSAL',
      reversalRequired: true,
      journalRefsToReverse: [...input.promotedJournalRefs],
      openItemRefsToReverse: [...input.promotedOpenItemRefs],
      preservesEvidence: true,
      rationale:
        'Financial effects exist. Undo is performed by governed reversal entries through CE-07 posting; ' +
        'original conversion journals and their lineage are preserved permanently.',
    };
  }

  if (!isPrePromotionState(input.state) && input.state !== MigrationState.RECONCILED && input.state !== MigrationState.READY_FOR_CUTOVER) {
    throw new RollbackError(
      `Run in state ${input.state} has no promoted financial effects but cannot be reset`,
      'ROLLBACK_NOT_APPLICABLE',
    );
  }

  const kind: RollbackKind = input.requestedKind === 'STAGED_DATA_RESET' ? 'STAGED_DATA_RESET' : 'PRE_PROMOTION_CANCEL';
  return {
    kind,
    reversalRequired: false,
    journalRefsToReverse: [],
    openItemRefsToReverse: [],
    preservesEvidence: true,
    rationale:
      kind === 'STAGED_DATA_RESET'
        ? 'No financial effects. Staged rows are discarded and re-derivable from the immutable source rows.'
        : 'No financial effects. The run is cancelled; staged data is retained as evidence of what was attempted.',
  };
}

export interface ReversalEntry {
  /** Original conversion journal being reversed. */
  originalJournalRef: string;
  /** Deterministic idempotency identity for the reversal posting. */
  idempotencyIdentity: string;
  /** Original lineage carried forward, never rewritten. */
  originalLineageRef: string | null;
  reason: string;
}

/**
 * Builds the reversal instruction set. Deterministic: the same plan produces
 * the same idempotency identities, so a retried rollback cannot double-reverse.
 */
export function buildReversalEntries(
  runId: string,
  plan: RollbackPlan,
  reason: string,
  lineageByJournal: Record<string, string> = {},
): ReversalEntry[] {
  if (!plan.reversalRequired) return [];
  return plan.journalRefsToReverse.map((journalRef) => ({
    originalJournalRef: journalRef,
    idempotencyIdentity: `migration-rollback:${runId}:${journalRef}`,
    originalLineageRef: lineageByJournal[journalRef] ?? null,
    reason,
  }));
}

/** A restart resumes from the last completed phase; it never re-does completed work. */
export interface RestartPlan {
  resumeFromState: MigrationState;
  /** Phases whose outputs are already durable and must not be recomputed. */
  completedPhases: string[];
  /** True when the run may simply continue rather than being recreated. */
  restartable: boolean;
}

export function planRestart(state: MigrationState, hasPromotedEffects: boolean): RestartPlan {
  if (state === MigrationState.ROLLED_BACK) {
    return { resumeFromState: state, completedPhases: [], restartable: false };
  }
  const order = [
    MigrationState.DISCOVERED,
    MigrationState.MAPPED,
    MigrationState.STAGED,
    MigrationState.VALIDATED,
    MigrationState.RECONCILED,
    MigrationState.READY_FOR_CUTOVER,
    MigrationState.CUTOVER_IN_PROGRESS,
    MigrationState.CUTOVER_COMPLETE,
  ];
  const idx = order.indexOf(state);
  const completedPhases = idx >= 0 ? order.slice(0, idx + 1).map(String) : [];
  return {
    resumeFromState: state,
    completedPhases,
    restartable: state !== MigrationState.CUTOVER_COMPLETE || !hasPromotedEffects,
  };
}

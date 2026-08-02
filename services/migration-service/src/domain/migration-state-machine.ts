/**
 * CE-16 Migration State Machine (S129/S130/S131/S132).
 *
 * Authoritative lifecycle per migration run (tenant × legalEntity × runId):
 *
 *   DISCOVERED → MAPPED → STAGED → VALIDATED → RECONCILED
 *              → READY_FOR_CUTOVER → CUTOVER_IN_PROGRESS → CUTOVER_COMPLETE
 *
 * Side states: ROLLED_BACK, MANUAL_REVIEW_REQUIRED.
 *
 * Package rules encoded here:
 *   * READY_FOR_CUTOVER is never reached by test success alone — it requires
 *     all gates PASS, zero unexplained parallel-run differences, zero blocking
 *     exceptions, a declared freeze, and CE-15 readiness approval.
 *   * Cutover is irreversible domain authority: CUTOVER_COMPLETE has no
 *     transition back to any pre-cutover state; the only post-cutover
 *     transition is ROLLED_BACK, which is itself a governed reversal
 *     (evidence preserved), never a deletion.
 */

export enum MigrationState {
  DISCOVERED = 'DISCOVERED',
  MAPPED = 'MAPPED',
  STAGED = 'STAGED',
  VALIDATED = 'VALIDATED',
  RECONCILED = 'RECONCILED',
  READY_FOR_CUTOVER = 'READY_FOR_CUTOVER',
  CUTOVER_IN_PROGRESS = 'CUTOVER_IN_PROGRESS',
  CUTOVER_COMPLETE = 'CUTOVER_COMPLETE',
  ROLLED_BACK = 'ROLLED_BACK',
  MANUAL_REVIEW_REQUIRED = 'MANUAL_REVIEW_REQUIRED',
}

export const MIGRATION_STATES = MigrationState;

export enum MigrationMode {
  REHEARSAL = 'REHEARSAL',
  PARALLEL = 'PARALLEL',
  CUTOVER = 'CUTOVER',
}

export class InvalidMigrationTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(public readonly from: MigrationState, public readonly to: MigrationState) {
    super(`Invalid migration transition from ${from} to ${to}`);
    this.name = 'InvalidMigrationTransitionError';
  }
}

export class CutoverPrerequisiteError extends Error {
  readonly code = 'CUTOVER_PREREQUISITES_NOT_MET';
  constructor(public readonly unmet: string[]) {
    super(`Cutover prerequisites not met: ${unmet.join(', ')}`);
    this.name = 'CutoverPrerequisiteError';
  }
}

export class MigrationSoDViolationError extends Error {
  readonly code = 'SOD_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'MigrationSoDViolationError';
  }
}

const VALID_TRANSITIONS: Record<MigrationState, MigrationState[]> = {
  [MigrationState.DISCOVERED]: [
    MigrationState.MAPPED,
    MigrationState.MANUAL_REVIEW_REQUIRED,
    MigrationState.ROLLED_BACK,
  ],
  [MigrationState.MAPPED]: [
    MigrationState.STAGED,
    MigrationState.DISCOVERED,
    MigrationState.MANUAL_REVIEW_REQUIRED,
    MigrationState.ROLLED_BACK,
  ],
  [MigrationState.STAGED]: [
    MigrationState.VALIDATED,
    MigrationState.MAPPED,
    MigrationState.MANUAL_REVIEW_REQUIRED,
    MigrationState.ROLLED_BACK,
  ],
  [MigrationState.VALIDATED]: [
    MigrationState.RECONCILED,
    MigrationState.STAGED,
    MigrationState.MANUAL_REVIEW_REQUIRED,
    MigrationState.ROLLED_BACK,
  ],
  [MigrationState.RECONCILED]: [
    MigrationState.READY_FOR_CUTOVER,
    MigrationState.VALIDATED,
    MigrationState.MANUAL_REVIEW_REQUIRED,
    MigrationState.ROLLED_BACK,
  ],
  [MigrationState.READY_FOR_CUTOVER]: [
    MigrationState.CUTOVER_IN_PROGRESS,
    MigrationState.RECONCILED,
    MigrationState.MANUAL_REVIEW_REQUIRED,
    MigrationState.ROLLED_BACK,
  ],
  [MigrationState.CUTOVER_IN_PROGRESS]: [
    MigrationState.CUTOVER_COMPLETE,
    MigrationState.ROLLED_BACK,
    MigrationState.MANUAL_REVIEW_REQUIRED,
  ],
  // Irreversible domain authority — no path back to any pre-cutover state.
  [MigrationState.CUTOVER_COMPLETE]: [MigrationState.ROLLED_BACK],
  // Terminal: a rolled-back run is evidence, never reused. Restart creates a
  // new run id rather than resurrecting this one.
  [MigrationState.ROLLED_BACK]: [],
  [MigrationState.MANUAL_REVIEW_REQUIRED]: [
    MigrationState.DISCOVERED,
    MigrationState.MAPPED,
    MigrationState.STAGED,
    MigrationState.VALIDATED,
    MigrationState.RECONCILED,
    MigrationState.ROLLED_BACK,
  ],
};

export function isValidTransition(from: MigrationState, to: MigrationState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransitionAllowed(from: MigrationState, to: MigrationState): void {
  if (!isValidTransition(from, to)) throw new InvalidMigrationTransitionError(from, to);
}

/** Everything a run must satisfy before READY_FOR_CUTOVER may be entered. */
export interface CutoverReadinessInput {
  /** Every G1–G5 gate evaluated PASS for every financial dataset in the run. */
  allGatesPassed: boolean;
  /** S131 exit criterion: 100% of differences explained AND dispositioned. */
  unexplainedDiffs: number;
  /** Exception queue: zero-or-dispositioned. */
  blockingExceptions: number;
  /** Source freeze attested (not merely scheduled). */
  freezeDeclared: boolean;
  /** Delta extraction after freeze completed. */
  deltaExtractionComplete: boolean;
  /** Controller sign-off recorded for every compared period. */
  allComparisonPeriodsSignedOff: boolean;
  /** CE-15 close readiness approval for the conversion period. */
  ce15ReadinessApproved: boolean;
  /** Backup taken and restore verified. */
  backupRestoreEvidence: boolean;
  /** Rollback plan demonstrated (not merely written). */
  rollbackPlanDemonstrated: boolean;
}

/**
 * Returns the list of unmet prerequisites. Empty array ⇒ ready.
 * Never auto-advances: callers must explicitly request the transition.
 */
export function evaluateCutoverReadiness(input: CutoverReadinessInput): string[] {
  const unmet: string[] = [];
  if (!input.allGatesPassed) unmet.push('GATES_NOT_ALL_PASSED');
  if (input.unexplainedDiffs > 0) unmet.push(`UNEXPLAINED_DIFFERENCES:${input.unexplainedDiffs}`);
  if (input.blockingExceptions > 0) unmet.push(`BLOCKING_EXCEPTIONS:${input.blockingExceptions}`);
  if (!input.freezeDeclared) unmet.push('FREEZE_NOT_ATTESTED');
  if (!input.deltaExtractionComplete) unmet.push('DELTA_EXTRACTION_INCOMPLETE');
  if (!input.allComparisonPeriodsSignedOff) unmet.push('COMPARISON_SIGN_OFF_MISSING');
  if (!input.ce15ReadinessApproved) unmet.push('CE15_READINESS_NOT_APPROVED');
  if (!input.backupRestoreEvidence) unmet.push('BACKUP_RESTORE_EVIDENCE_MISSING');
  if (!input.rollbackPlanDemonstrated) unmet.push('ROLLBACK_PLAN_NOT_DEMONSTRATED');
  return unmet;
}

export interface TransitionContext {
  actor: string;
  /** Only supplied when the requested target is READY_FOR_CUTOVER. */
  readiness?: CutoverReadinessInput;
  /** Only supplied when the requested target is CUTOVER_IN_PROGRESS. */
  cutoverApproval?: { preparedBy: string; approvedBy: string | null };
}

/**
 * Applies a transition, enforcing structural validity, cutover prerequisites
 * and cutover SoD in one place. Pure — no I/O, no clock reads.
 */
export function applyMigrationTransition(
  current: MigrationState,
  requested: MigrationState,
  ctx: TransitionContext,
): MigrationState {
  assertTransitionAllowed(current, requested);

  if (requested === MigrationState.READY_FOR_CUTOVER) {
    if (!ctx.readiness) throw new CutoverPrerequisiteError(['READINESS_EVIDENCE_NOT_SUPPLIED']);
    const unmet = evaluateCutoverReadiness(ctx.readiness);
    if (unmet.length > 0) throw new CutoverPrerequisiteError(unmet);
  }

  if (requested === MigrationState.CUTOVER_IN_PROGRESS) {
    const approval = ctx.cutoverApproval;
    if (!approval || !approval.approvedBy) {
      throw new CutoverPrerequisiteError(['CUTOVER_APPROVAL_MISSING']);
    }
    if (approval.preparedBy === approval.approvedBy) {
      throw new MigrationSoDViolationError(
        `Cutover preparer ${approval.preparedBy} may not also grant final cutover approval`,
      );
    }
  }

  return requested;
}

/** Which states still permit destructive staged-data reset (pre-promotion). */
export function isPrePromotionState(state: MigrationState): boolean {
  return [
    MigrationState.DISCOVERED,
    MigrationState.MAPPED,
    MigrationState.STAGED,
    MigrationState.VALIDATED,
    MigrationState.MANUAL_REVIEW_REQUIRED,
  ].includes(state);
}

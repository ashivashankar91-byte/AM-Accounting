/**
 * CE-16 — Cutover ceremony.
 *
 * Cutover is irreversible domain authority. It is never inferred from test
 * success: it requires an explicit ceremony carrying an irreversible-effect
 * statement, dual segregation of duties (preparer ≠ approver), a freeze
 * attestation, completed delta extraction, satisfied reconciliation
 * thresholds, resolved blocking exceptions, CE-15 readiness approval,
 * backup/restore evidence and a demonstrated rollback plan.
 *
 * Pure module — no I/O, no clock reads.
 */

import { CutoverReadinessInput, evaluateCutoverReadiness } from './migration-state-machine';

export type CeremonyState = 'PENDING' | 'PREPARED' | 'APPROVED' | 'EXECUTING' | 'COMPLETE' | 'ROLLED_BACK';

export const IRREVERSIBLE_EFFECT_STATEMENT =
  'I acknowledge that executing this cutover permanently establishes the converted balances, ' +
  'open items and schedules as the authoritative accounting record for this legal entity. ' +
  'This action is irreversible: it can only be undone by governed reversal entries that ' +
  'themselves become part of the permanent audit record. No evidence will be deleted.';

export class CutoverCeremonyError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'CutoverCeremonyError';
  }
}

export interface CeremonyPreparation {
  runId: string;
  tenantId: string;
  legalEntityId: string;
  sourceSystemIds: string[];
  runIds: string[];
  freezeTimestamp: string | null;
  transformationVersions: string[];
  targetEnvironment: string;
  rollbackBoundary: string;
  backupEvidence: Record<string, unknown>;
  rollbackPlanEvidence: Record<string, unknown>;
  preparedBy: string;
}

export interface PreparedCeremony extends CeremonyPreparation {
  irreversibleEffectStatement: string;
  state: CeremonyState;
}

export function prepareCeremony(input: CeremonyPreparation): PreparedCeremony {
  const missing: string[] = [];
  if (!input.freezeTimestamp) missing.push('FREEZE_TIMESTAMP');
  if (input.sourceSystemIds.length === 0) missing.push('SOURCE_SYSTEM_IDS');
  if (input.transformationVersions.length === 0) missing.push('TRANSFORMATION_VERSIONS');
  if (!input.rollbackBoundary) missing.push('ROLLBACK_BOUNDARY');
  if (!input.backupEvidence || Object.keys(input.backupEvidence).length === 0) missing.push('BACKUP_EVIDENCE');
  if (!input.rollbackPlanEvidence || Object.keys(input.rollbackPlanEvidence).length === 0) {
    missing.push('ROLLBACK_PLAN_EVIDENCE');
  }
  if (missing.length > 0) {
    throw new CutoverCeremonyError(`Cutover preparation incomplete: ${missing.join(', ')}`, 'PREPARATION_INCOMPLETE');
  }

  return { ...input, irreversibleEffectStatement: IRREVERSIBLE_EFFECT_STATEMENT, state: 'PREPARED' };
}

export interface ApprovalInput {
  preparedBy: string;
  approverIdentity: string;
  acknowledgedStatement: string;
  readiness: CutoverReadinessInput;
  currentState: CeremonyState;
}

export interface ApprovalOutcome {
  state: CeremonyState;
  approverIdentity: string;
  acknowledgedStatement: string;
}

/**
 * Grants final cutover approval. Preparation is not approval: the identity
 * that prepared the ceremony can never be the identity that approves it.
 */
export function approveCeremony(input: ApprovalInput): ApprovalOutcome {
  if (input.currentState !== 'PREPARED') {
    throw new CutoverCeremonyError(
      `Cutover ceremony must be PREPARED before approval (currently ${input.currentState})`,
      'CEREMONY_NOT_PREPARED',
    );
  }
  if (!input.approverIdentity) {
    throw new CutoverCeremonyError('Approver identity is required', 'APPROVER_REQUIRED');
  }
  if (input.preparedBy === input.approverIdentity) {
    throw new CutoverCeremonyError(
      `Preparer ${input.preparedBy} may not grant final cutover approval (dual SoD required)`,
      'SOD_VIOLATION',
    );
  }
  if (input.acknowledgedStatement.trim() !== IRREVERSIBLE_EFFECT_STATEMENT) {
    throw new CutoverCeremonyError(
      'Approver must acknowledge the exact irreversible-effect statement',
      'IRREVERSIBLE_STATEMENT_NOT_ACKNOWLEDGED',
    );
  }

  const unmet = evaluateCutoverReadiness(input.readiness);
  if (unmet.length > 0) {
    throw new CutoverCeremonyError(`Cutover prerequisites not met: ${unmet.join(', ')}`, 'CUTOVER_PREREQUISITES_NOT_MET');
  }

  return {
    state: 'APPROVED',
    approverIdentity: input.approverIdentity,
    acknowledgedStatement: input.acknowledgedStatement,
  };
}

export interface ExecutionInput {
  currentState: CeremonyState;
  executedBy: string;
  approverIdentity: string | null;
}

export interface ExecutionOutcome {
  state: CeremonyState;
  /** True when the ceremony was already COMPLETE — the call is a safe no-op. */
  idempotentReplay: boolean;
}

/**
 * Executes an approved cutover. A second execution of an already-complete
 * ceremony returns the same result and is not an error — replaying a cutover
 * must never produce a second set of effects, and must never look like a
 * failure to the operator retrying after a timeout.
 */
export function executeCeremony(input: ExecutionInput): ExecutionOutcome {
  if (input.currentState === 'COMPLETE') return { state: 'COMPLETE', idempotentReplay: true };
  if (input.currentState === 'ROLLED_BACK') {
    throw new CutoverCeremonyError('A rolled-back cutover cannot be re-executed', 'CEREMONY_ROLLED_BACK');
  }
  if (input.currentState !== 'APPROVED' && input.currentState !== 'EXECUTING') {
    throw new CutoverCeremonyError(
      `Cutover ceremony must be APPROVED before execution (currently ${input.currentState})`,
      'CEREMONY_NOT_APPROVED',
    );
  }
  if (!input.approverIdentity) {
    throw new CutoverCeremonyError('Cutover ceremony has no recorded approver', 'APPROVER_REQUIRED');
  }
  return { state: 'COMPLETE', idempotentReplay: false };
}

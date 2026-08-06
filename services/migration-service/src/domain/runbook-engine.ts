/**
 * CE-16 / S132b — Runbook templates and instances.
 *
 * A runbook instance is created from a template and then owns its own state:
 * every step carries an owner, a status, evidence refs and an optional gate
 * linkage. A step whose linked gate has not passed cannot be completed — the
 * runbook is a control, not a checklist.
 *
 * Pure module — no I/O, no clock reads.
 */

export type RunbookPhase =
  | 'DISCOVERY'
  | 'MAPPING'
  | 'REHEARSAL'
  | 'PARALLEL'
  | 'FREEZE'
  | 'DELTA'
  | 'CUTOVER'
  | 'POST_CUTOVER';

export type RunbookStepStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'BLOCKED' | 'SKIPPED';

export interface RunbookStep {
  code: string;
  phase: RunbookPhase;
  title: string;
  owner: string | null;
  status: RunbookStepStatus;
  evidenceRefs: string[];
  /** G1–G5 gate code, or a run-state precondition, this step depends on. */
  gateLinkage: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
  note?: string | null;
}

export const DEFAULT_RUNBOOK_TEMPLATE_NAME = 'AMACC Standard Migration Runbook';

export const DEFAULT_RUNBOOK_STEPS: RunbookStep[] = [
  { code: 'D1', phase: 'DISCOVERY', title: 'Register source systems and confirm extract access', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: null },
  { code: 'D2', phase: 'DISCOVERY', title: 'Inventory legacy COA, departments, entities and rooftops', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: null },
  { code: 'M1', phase: 'MAPPING', title: 'Classify every legacy account ALIGN / MAP / DIVERGE', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'COVERAGE_100' },
  { code: 'M2', phase: 'MAPPING', title: 'Freeze mapping set version and capture approval evidence', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'MAPPING_FROZEN' },
  { code: 'R1', phase: 'REHEARSAL', title: 'Execute full rehearsal run in an isolated target', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'STATE_VALIDATED' },
  { code: 'R2', phase: 'REHEARSAL', title: 'Evaluate gates G1–G5 and clear the exception queue', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'G5' },
  { code: 'P1', phase: 'PARALLEL', title: 'Ingest legacy period outputs and run comparison', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: null },
  { code: 'P2', phase: 'PARALLEL', title: 'Explain and disposition every difference; controller sign-off', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'COMPARISON_SIGNED_OFF' },
  { code: 'F1', phase: 'FREEZE', title: 'Declare legacy source freeze and capture attestation', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'FREEZE_ATTESTED' },
  { code: 'X1', phase: 'DELTA', title: 'Extract and stage post-freeze delta', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'DELTA_COMPLETE' },
  { code: 'C1', phase: 'CUTOVER', title: 'Prepare cutover ceremony with backup and rollback evidence', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'STATE_READY_FOR_CUTOVER' },
  { code: 'C2', phase: 'CUTOVER', title: 'Separate authorised approver grants final cutover approval', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'CUTOVER_APPROVED' },
  { code: 'C3', phase: 'CUTOVER', title: 'Execute cutover and confirm authoritative conversion journals', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: 'STATE_CUTOVER_COMPLETE' },
  { code: 'Z1', phase: 'POST_CUTOVER', title: 'Post-cutover reconciliation and lineage spot-checks', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: null },
  { code: 'Z2', phase: 'POST_CUTOVER', title: 'Archive legacy statements under WORM retention', owner: null, status: 'PENDING', evidenceRefs: [], gateLinkage: null },
];

export class RunbookStepError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'RunbookStepError';
  }
}

export function instantiateTemplate(steps: RunbookStep[]): RunbookStep[] {
  return steps.map((s) => ({ ...s, status: 'PENDING', evidenceRefs: [], completedBy: null, completedAt: null }));
}

export interface StepUpdate {
  stepCode: string;
  status?: RunbookStepStatus;
  owner?: string | null;
  evidenceRefs?: string[];
  note?: string | null;
  actor: string;
  completedAt: string;
  /** Gate codes currently satisfied for the run this instance belongs to. */
  satisfiedGates: string[];
}

export function applyStepUpdate(steps: RunbookStep[], update: StepUpdate): RunbookStep[] {
  const index = steps.findIndex((s) => s.code === update.stepCode);
  if (index < 0) throw new RunbookStepError(`Unknown runbook step ${update.stepCode}`, 'STEP_NOT_FOUND');
  const step = steps[index];

  if (update.status === 'COMPLETE') {
    if (step.gateLinkage && !update.satisfiedGates.includes(step.gateLinkage)) {
      throw new RunbookStepError(
        `Step ${step.code} is linked to gate ${step.gateLinkage}, which is not satisfied`,
        'GATE_NOT_SATISFIED',
      );
    }
    if ((update.evidenceRefs ?? step.evidenceRefs).length === 0) {
      throw new RunbookStepError(`Step ${step.code} cannot be completed without evidence`, 'EVIDENCE_REQUIRED');
    }
  }

  const next: RunbookStep = {
    ...step,
    status: update.status ?? step.status,
    owner: update.owner !== undefined ? update.owner : step.owner,
    evidenceRefs: update.evidenceRefs ?? step.evidenceRefs,
    note: update.note !== undefined ? update.note : step.note ?? null,
    completedBy: update.status === 'COMPLETE' ? update.actor : step.completedBy ?? null,
    completedAt: update.status === 'COMPLETE' ? update.completedAt : step.completedAt ?? null,
  };

  const copy = [...steps];
  copy[index] = next;
  return copy;
}

export function runbookProgress(steps: RunbookStep[]): { total: number; complete: number; blocked: number; percent: number } {
  const total = steps.length;
  const complete = steps.filter((s) => s.status === 'COMPLETE' || s.status === 'SKIPPED').length;
  const blocked = steps.filter((s) => s.status === 'BLOCKED').length;
  return { total, complete, blocked, percent: total === 0 ? 0 : Math.round((complete / total) * 100) };
}

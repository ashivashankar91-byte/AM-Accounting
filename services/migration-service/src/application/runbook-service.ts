import { inject, injectable } from 'tsyringe';
import { IRunbookRepository, IGateRepository, IMigrationRunRepository, IComparisonRepository } from '../domain/interfaces';
import {
  DEFAULT_RUNBOOK_STEPS, DEFAULT_RUNBOOK_TEMPLATE_NAME, instantiateTemplate, applyStepUpdate,
  runbookProgress, RunbookStep, RunbookStepStatus,
} from '../domain/runbook-engine';
import { MigrationState } from '../domain/migration-state-machine';

export const BUILT_IN_TEMPLATE_ID = 'default';

@injectable()
export class RunbookService {
  constructor(
    @inject('IRunbookRepository') private readonly repo: IRunbookRepository,
    @inject('IGateRepository') private readonly gates: IGateRepository,
    @inject('IMigrationRunRepository') private readonly runs: IMigrationRunRepository,
    @inject('IComparisonRepository') private readonly comparisons: IComparisonRepository,
  ) {}

  async listTemplates(tenantId: string) {
    const templates = await this.repo.listTemplates(tenantId);
    // The standard runbook is always offered, so the migration phases are
    // never invented ad hoc at cutover time by whoever happens to be on call.
    return [
      {
        id: BUILT_IN_TEMPLATE_ID,
        tenantId,
        name: DEFAULT_RUNBOOK_TEMPLATE_NAME,
        version: 1,
        steps: DEFAULT_RUNBOOK_STEPS,
        builtIn: true,
      },
      ...templates.map((t: any) => ({ ...t, builtIn: false })),
    ];
  }

  createTemplate(input: { tenantId: string; name: string; steps?: RunbookStep[]; actor: string }) {
    return this.repo.createTemplate({
      tenantId: input.tenantId,
      name: input.name,
      version: 1,
      steps: (input.steps ?? DEFAULT_RUNBOOK_STEPS) as unknown,
      createdBy: input.actor,
    });
  }

  listInstances(tenantId: string, runId?: string) {
    return this.repo.listInstances(tenantId, runId);
  }

  async createInstance(input: {
    tenantId: string; legalEntityId: string; runId: string; templateId?: string; actor: string;
  }) {
    let steps = DEFAULT_RUNBOOK_STEPS;
    let templateId = input.templateId ?? BUILT_IN_TEMPLATE_ID;
    if (templateId !== BUILT_IN_TEMPLATE_ID) {
      const template = await this.repo.findTemplate(input.tenantId, templateId);
      if (!template) {
        const err: any = new Error(`Runbook template ${templateId} not found`);
        err.statusCode = 404;
        err.code = 'TEMPLATE_NOT_FOUND';
        throw err;
      }
      steps = template.steps as RunbookStep[];
      templateId = template.id;
    }
    const instance = await this.repo.createInstance({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      templateId,
      runId: input.runId,
      steps: instantiateTemplate(steps) as unknown,
      createdBy: input.actor,
    });
    return { ...instance, progress: runbookProgress(instance.steps as RunbookStep[]) };
  }

  async getInstance(tenantId: string, id: string) {
    const instance = await this.repo.findInstance(tenantId, id);
    if (!instance) {
      const err: any = new Error(`Runbook instance ${id} not found`);
      err.statusCode = 404;
      err.code = 'RUNBOOK_INSTANCE_NOT_FOUND';
      throw err;
    }
    const steps = instance.steps as RunbookStep[];
    const satisfiedGates = await this.satisfiedGates(tenantId, instance.runId);
    return { instance, steps, progress: runbookProgress(steps), satisfiedGates };
  }

  /**
   * Resolves which gate linkages are genuinely satisfied for a run.
   *
   * Every linkage is answered from persisted evidence — gate results, run
   * state, freeze attestation, comparison sign-off — so ticking a runbook box
   * can never substitute for the underlying control.
   */
  async satisfiedGates(tenantId: string, runId: string): Promise<string[]> {
    const satisfied: string[] = [];
    const [gateRows, run, allSignedOff] = await Promise.all([
      this.gates.list(tenantId, runId),
      this.runs.findByRunId(tenantId, runId),
      this.comparisons.allPeriodsSignedOff(tenantId, runId),
    ]);

    const seen = new Set<string>();
    for (const row of gateRows as any[]) {
      if (seen.has(row.gateCode)) continue;
      seen.add(row.gateCode);
      if (row.result === 'PASS') satisfied.push(row.gateCode);
    }

    if (!run) return satisfied;

    satisfied.push(`STATE_${run.state}`);
    const order = [
      MigrationState.DISCOVERED, MigrationState.MAPPED, MigrationState.STAGED, MigrationState.VALIDATED,
      MigrationState.RECONCILED, MigrationState.READY_FOR_CUTOVER, MigrationState.CUTOVER_IN_PROGRESS,
      MigrationState.CUTOVER_COMPLETE,
    ];
    const idx = order.indexOf(run.state as MigrationState);
    if (idx >= 0) for (const s of order.slice(0, idx + 1)) satisfied.push(`STATE_${s}`);

    if (run.frozenAt) satisfied.push('FREEZE_ATTESTED');
    if (run.approvedBy) satisfied.push('CUTOVER_APPROVED');
    if (allSignedOff) satisfied.push('COMPARISON_SIGNED_OFF');
    const metadata = (run.metadata ?? {}) as Record<string, unknown>;
    if (metadata['deltaExtractionComplete']) satisfied.push('DELTA_COMPLETE');
    if (metadata['mappingFrozen']) satisfied.push('MAPPING_FROZEN');
    if (metadata['mappingCoverageComplete']) satisfied.push('COVERAGE_100');

    return [...new Set(satisfied)];
  }

  /**
   * Updates a step. Where a step declares a gate linkage, the gate must
   * actually be satisfied before the step can be marked complete, and a
   * completed step must carry evidence.
   */
  async updateStep(input: {
    tenantId: string; instanceId: string; actor: string;
    stepCode: string; status?: string; owner?: string | null; evidenceRefs?: string[]; note?: string | null;
  }) {
    const { instance, steps, satisfiedGates } = await this.getInstance(input.tenantId, input.instanceId);

    const nextSteps = applyStepUpdate(steps, {
      stepCode: input.stepCode,
      status: input.status as RunbookStepStatus | undefined,
      owner: input.owner,
      evidenceRefs: input.evidenceRefs,
      note: input.note,
      actor: input.actor,
      completedAt: new Date().toISOString(),
      satisfiedGates,
    });

    const progress = runbookProgress(nextSteps);
    const updated = await this.repo.updateInstance(input.tenantId, input.instanceId, {
      steps: nextSteps as unknown,
      state: progress.complete === progress.total ? 'COMPLETE' : 'ACTIVE',
    });
    return { instance: updated, steps: nextSteps, progress, satisfiedGates };
  }

  async abandon(tenantId: string, instanceId: string, reason: string) {
    await this.getInstance(tenantId, instanceId);
    return this.repo.updateInstance(tenantId, instanceId, { state: 'ABANDONED', abandonReason: reason });
  }
}

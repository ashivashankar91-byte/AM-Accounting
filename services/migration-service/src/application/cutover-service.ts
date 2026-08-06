import { inject, injectable } from 'tsyringe';
import {
  ICutoverRepository, IMigrationRunRepository, IStagingRepository, IPostingClient,
  ILineageRepository, IEventPublisherPort,
} from '../domain/interfaces';
import {
  prepareCeremony, approveCeremony, executeCeremony, IRREVERSIBLE_EFFECT_STATEMENT, CutoverCeremonyError,
} from '../domain/cutover-ceremony';
import { assessRollback, buildReversalEntries, planRestart, RollbackKind } from '../domain/rollback-engine';
import { MigrationState } from '../domain/migration-state-machine';
import { MigrationRunService } from './migration-run-service';
import { PromotionService } from './promotion-service';
import { MIGRATION_EVENTS } from '../infrastructure/migration-event-publisher';

@injectable()
export class CutoverService {
  constructor(
    @inject('ICutoverRepository') private readonly repo: ICutoverRepository,
    @inject('IMigrationRunRepository') private readonly runs: IMigrationRunRepository,
    @inject('IStagingRepository') private readonly staging: IStagingRepository,
    @inject('IPostingClient') private readonly posting: IPostingClient,
    @inject('ILineageRepository') private readonly lineage: ILineageRepository,
    @inject('IEventPublisherPort') private readonly events: IEventPublisherPort,
    private readonly runService: MigrationRunService,
    private readonly promotion: PromotionService,
  ) {}

  /** The statement is served from the domain constant so the UI cannot soften it. */
  get irreversibleEffectStatement() {
    return IRREVERSIBLE_EFFECT_STATEMENT;
  }

  async getCeremony(tenantId: string, runId: string) {
    const ceremony = await this.repo.find(tenantId, runId);
    const readiness = await this.runService.computeReadiness(tenantId, runId);
    return {
      ceremony,
      readiness,
      irreversibleEffectStatement: IRREVERSIBLE_EFFECT_STATEMENT,
    };
  }

  async prepare(input: {
    tenantId: string; legalEntityId: string; runId: string; actor: string;
    sourceSystemIds: string[]; targetEnvironment: string; rollbackBoundary: string;
    backupEvidence: Record<string, unknown>; rollbackPlanEvidence: Record<string, unknown>;
  }) {
    const run = await this.runService.get(input.tenantId, input.runId);
    const datasets = await this.staging.listDatasets(input.tenantId, input.runId);
    const transformationVersions = [
      ...new Set([run.transformationVersion, ...(datasets as any[]).map((d) => d.transformationVersion)].filter(Boolean)),
    ];

    const prepared = prepareCeremony({
      runId: input.runId,
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      sourceSystemIds: input.sourceSystemIds,
      runIds: [input.runId],
      freezeTimestamp: run.frozenAt ? run.frozenAt.toISOString() : null,
      transformationVersions,
      targetEnvironment: input.targetEnvironment,
      rollbackBoundary: input.rollbackBoundary,
      backupEvidence: input.backupEvidence,
      rollbackPlanEvidence: input.rollbackPlanEvidence,
      preparedBy: input.actor,
    });

    const saved = await this.repo.upsert({
      tenantId: input.tenantId,
      runId: input.runId,
      legalEntityId: input.legalEntityId,
      sourceSystemIds: prepared.sourceSystemIds,
      runIds: prepared.runIds,
      freezeTimestamp: run.frozenAt,
      transformationVersions: prepared.transformationVersions,
      targetEnvironment: prepared.targetEnvironment,
      irreversibleEffectStatement: prepared.irreversibleEffectStatement,
      rollbackBoundary: prepared.rollbackBoundary,
      backupEvidence: prepared.backupEvidence,
      rollbackPlanEvidence: prepared.rollbackPlanEvidence,
      preparedBy: input.actor,
      preparedAt: new Date(),
      state: 'PREPARED',
    });

    await this.runs.patch(input.tenantId, input.runId, { preparedBy: input.actor });
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: input.runId, action: 'CUTOVER_PREPARED', actor: input.actor,
      evidence: { targetEnvironment: input.targetEnvironment, transformationVersions },
    });
    return saved;
  }

  /**
   * Final approval. Preparation is not approval: the preparer is rejected here
   * even if they hold the approve permission.
   */
  async approve(input: { tenantId: string; runId: string; actor: string; acknowledgedStatement: string }) {
    const ceremony = await this.repo.find(input.tenantId, input.runId);
    if (!ceremony) {
      throw new CutoverCeremonyError('No cutover ceremony has been prepared for this run', 'CEREMONY_NOT_PREPARED');
    }
    const readiness = await this.runService.computeReadiness(input.tenantId, input.runId);

    const outcome = approveCeremony({
      preparedBy: ceremony.preparedBy,
      approverIdentity: input.actor,
      acknowledgedStatement: input.acknowledgedStatement,
      readiness,
      currentState: ceremony.state,
    });

    const saved = await this.repo.update(input.tenantId, input.runId, {
      state: outcome.state,
      approverIdentity: outcome.approverIdentity,
      approvedAt: new Date(),
      approvalEvidence: { acknowledgedStatement: outcome.acknowledgedStatement, readiness } as any,
    });
    await this.runs.patch(input.tenantId, input.runId, { approvedBy: input.actor, approvalAt: new Date() });
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: input.runId, action: 'CUTOVER_APPROVED', actor: input.actor,
      evidence: { readiness },
    });
    return saved;
  }

  /**
   * Executes the approved cutover. A repeat execution of a completed ceremony
   * returns the same completed result without producing a second set of
   * effects and without raising an error.
   */
  async execute(input: { tenantId: string; runId: string; actor: string }) {
    const ceremony = await this.repo.find(input.tenantId, input.runId);
    if (!ceremony) {
      throw new CutoverCeremonyError('No cutover ceremony has been prepared for this run', 'CEREMONY_NOT_PREPARED');
    }

    const outcome = executeCeremony({
      currentState: ceremony.state,
      executedBy: input.actor,
      approverIdentity: ceremony.approverIdentity,
    });

    if (outcome.idempotentReplay) {
      return { state: outcome.state, idempotentReplay: true, ceremony, runState: MigrationState.CUTOVER_COMPLETE };
    }

    // Compare-and-set before anything irreversible happens. Two operators
    // pressing execute at the same moment must not both run the ceremony; the
    // loser is served the same answer as any later replay.
    //
    // Only an APPROVED ceremony may be claimed. A ceremony already EXECUTING or
    // COMPLETE is answered as a replay rather than run a second time; a
    // ceremony genuinely stranded in EXECUTING is an operational incident and
    // is resolved through rollback/restart, not by a silent re-execution.
    const claimed = await this.repo.claim(
      input.tenantId, input.runId, 'APPROVED', 'EXECUTING', { executionStartedAt: new Date() },
    );
    if (!claimed) {
      const current = await this.repo.find(input.tenantId, input.runId);
      return {
        state: current?.state === 'COMPLETE' ? 'COMPLETE' : (current?.state ?? 'EXECUTING'),
        idempotentReplay: true,
        ceremony: current,
        runState: MigrationState.CUTOVER_COMPLETE,
      };
    }

    await this.events.publishMigrationEvent(MIGRATION_EVENTS.CUTOVER_INITIATED, input.tenantId, {
      runId: input.runId, actor: input.actor, approverIdentity: ceremony.approverIdentity,
    });

    const run = await this.runService.get(input.tenantId, input.runId);
    if (run.state === MigrationState.READY_FOR_CUTOVER) {
      await this.runService.transition(input.tenantId, input.runId, MigrationState.CUTOVER_IN_PROGRESS, input.actor, 'Cutover ceremony executed');
    }

    const saved = await this.repo.update(input.tenantId, input.runId, {
      state: 'COMPLETE', executionCompletedAt: new Date(),
    });
    const inProgress = await this.runService.get(input.tenantId, input.runId);
    if (inProgress.state !== MigrationState.CUTOVER_COMPLETE) {
      await this.runService.transition(input.tenantId, input.runId, MigrationState.CUTOVER_COMPLETE, input.actor, 'Cutover complete');
    }
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: input.runId, action: 'CUTOVER_EXECUTED', actor: input.actor,
      evidence: { approverIdentity: ceremony.approverIdentity },
    });
    await this.events.publishMigrationEvent(MIGRATION_EVENTS.CUTOVER_COMPLETE, input.tenantId, {
      runId: input.runId, actor: input.actor,
    });

    return { state: 'COMPLETE', idempotentReplay: false, ceremony: saved, runState: MigrationState.CUTOVER_COMPLETE };
  }

  /**
   * Rollback. Where financial effects exist the undo is performed by governed
   * reversal entries through CE-07 carrying the original lineage; staged rows,
   * source rows, exceptions and audit history are never deleted.
   */
  async rollback(input: { tenantId: string; runId: string; actor: string; reason: string; requestedKind?: string }) {
    if (!input.reason || input.reason.trim().length < 5) {
      const err: any = new Error('A rollback reason is required');
      err.statusCode = 400;
      err.code = 'ROLLBACK_REASON_REQUIRED';
      throw err;
    }
    const run = await this.runService.get(input.tenantId, input.runId);
    const effects = await this.promotion.promotedEffects(input.tenantId, input.runId);

    const plan = assessRollback({
      state: run.state as MigrationState,
      promotedJournalRefs: effects.journalRefs,
      promotedOpenItemRefs: effects.openItemRefs,
      requestedKind: input.requestedKind as RollbackKind | undefined,
    });

    await this.events.publishMigrationEvent(MIGRATION_EVENTS.ROLLBACK_INITIATED, input.tenantId, {
      runId: input.runId, kind: plan.kind, actor: input.actor,
    });
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: input.runId, action: 'ROLLBACK_INITIATED', actor: input.actor,
      reason: input.reason, evidence: { plan },
    });

    const reversals = buildReversalEntries(input.runId, plan, input.reason, effects.lineageByJournal);
    const reversalResults: {
      originalJournalRef: string; status: string; reversalJournalRef: string | null; postingExecutionRef: string | null;
    }[] = [];

    for (const reversal of reversals) {
      const original = await this.lineage.list(input.tenantId, input.runId, { journalRef: reversal.originalJournalRef });
      const lines = await this.buildReversalLines(input.tenantId, input.runId, reversal.originalJournalRef);

      const posted = await this.posting.post({
        tenantId: input.tenantId,
        legalEntityId: run.legalEntityId,
        runId: input.runId,
        idempotencyIdentity: reversal.idempotencyIdentity,
        businessDate: new Date().toISOString().slice(0, 10),
        journalFamily: 'CONVERSION_REVERSAL',
        memo: `CE-16 conversion reversal — run ${input.runId} reversing ${reversal.originalJournalRef}: ${input.reason}`,
        lines,
        originalJournalRef: reversal.originalJournalRef,
      });

      reversalResults.push({
        originalJournalRef: reversal.originalJournalRef,
        status: posted.status,
        reversalJournalRef: posted.journalRef,
        postingExecutionRef: posted.postingExecutionRef,
      });

      if (posted.status === 'POSTED') {
        // The reversal is recorded as a new lineage row that points back at the
        // original journal. The original rows are left exactly as they were.
        await this.lineage.record([{
          tenantId: input.tenantId,
          runId: input.runId,
          transformationVersion: run.transformationVersion,
          targetRecordId: posted.journalRef,
          targetRecordType: 'JOURNAL_ENTRY_REVERSAL',
          postingExecutionRef: posted.postingExecutionRef,
          journalRef: posted.journalRef,
          evidence: {
            reversalOf: reversal.originalJournalRef,
            originalLineageRef: reversal.originalLineageRef,
            originalLineageRows: (original as any[]).length,
            reason: input.reason,
            evidencePreserved: true,
          },
        }]);
      }
    }

    if (plan.kind === 'STAGED_DATA_RESET') {
      const datasets = await this.staging.listDatasets(input.tenantId, input.runId);
      for (const dataset of datasets as any[]) {
        await this.staging.resetRows(input.tenantId, dataset.id);
        await this.staging.updateDataset(input.tenantId, dataset.id, { state: 'RESET' });
      }
    }

    await this.repo.update(input.tenantId, input.runId, { state: 'ROLLED_BACK' }).catch(() => undefined);
    await this.runs.updateState(input.tenantId, input.runId, MigrationState.ROLLED_BACK, { rolledBackAt: new Date() });
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: input.runId, action: 'ROLLBACK_COMPLETE', actor: input.actor,
      fromState: run.state, toState: MigrationState.ROLLED_BACK, reason: input.reason,
      evidence: { plan, reversalResults, evidencePreserved: true },
    });
    await this.events.publishMigrationEvent(MIGRATION_EVENTS.ROLLBACK_COMPLETE, input.tenantId, {
      runId: input.runId, kind: plan.kind, reversals: reversalResults.length,
    });

    return { plan, reversals: reversalResults, evidencePreserved: true };
  }

  /** Mirrors the promoted lines so the reversal is arithmetically exact. */
  private async buildReversalLines(tenantId: string, runId: string, journalRef: string) {
    const datasets = await this.staging.listDatasets(tenantId, runId);
    const lines: { accountCode: string; debit: number; credit: number; description: string; sourceRowRef?: string }[] = [];
    for (const dataset of datasets as any[]) {
      const rows = await this.staging.listRows(tenantId, dataset.id, 100000, 0);
      for (const row of rows as any[]) {
        if (row.promotedRecordId !== journalRef) continue;
        const data = row.stagedData as Record<string, unknown>;
        lines.push({
          accountCode: String(data['accountCode'] ?? ''),
          debit: Number(data['credit'] ?? 0),
          credit: Number(data['debit'] ?? 0),
          description: `Reversal of ${journalRef}`,
          sourceRowRef: row.sourceRowId ?? row.rowHash,
        });
      }
    }
    return lines;
  }

  async restartPlan(tenantId: string, runId: string) {
    const run = await this.runService.get(tenantId, runId);
    const effects = await this.promotion.promotedEffects(tenantId, runId);
    return planRestart(run.state as MigrationState, effects.journalRefs.length > 0 || effects.openItemRefs.length > 0);
  }
}

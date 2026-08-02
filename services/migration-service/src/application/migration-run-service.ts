import { inject, injectable } from 'tsyringe';
import {
  IMigrationRunRepository, IExceptionRepository, IGateRepository, IComparisonRepository,
  ICloseReadinessProvider, IEventPublisherPort, ICutoverRepository,
} from '../domain/interfaces';
import {
  MigrationState, MigrationMode, applyMigrationTransition, CutoverReadinessInput,
  evaluateCutoverReadiness,
} from '../domain/migration-state-machine';
import { allGatesPassed } from '../domain/gate-evaluator';
import { MIGRATION_EVENTS } from '../infrastructure/migration-event-publisher';

export class MigrationRunNotFoundError extends Error {
  readonly code = 'RUN_NOT_FOUND';
  readonly statusCode = 404;
  constructor(runId: string) {
    super(`Migration run ${runId} not found`);
    this.name = 'MigrationRunNotFoundError';
  }
}

export interface ReadinessReport extends CutoverReadinessInput {
  unmet: string[];
  ready: boolean;
  ce15Detail: string;
  ce15EvidenceAge?: number | null;
  ce15CloseState?: string | null;
  ce15Stale?: boolean;
}

/** Evidence captured more than 1 hour ago must not authorise cutover. */
const CE15_EVIDENCE_MAX_AGE_MS = 60 * 60 * 1_000;

@injectable()
export class MigrationRunService {
  constructor(
    @inject('IMigrationRunRepository') private readonly runs: IMigrationRunRepository,
    @inject('IExceptionRepository') private readonly exceptions: IExceptionRepository,
    @inject('IGateRepository') private readonly gates: IGateRepository,
    @inject('IComparisonRepository') private readonly comparisons: IComparisonRepository,
    @inject('ICutoverRepository') private readonly cutovers: ICutoverRepository,
    @inject('ICloseReadinessProvider') private readonly closeReadiness: ICloseReadinessProvider,
    @inject('IEventPublisherPort') private readonly events: IEventPublisherPort,
  ) {}

  async create(input: {
    tenantId: string; legalEntityId: string; mode: string; transformationVersion: string;
    sourceSnapshotRef?: string | null; actor: string; runId?: string; metadata?: Record<string, unknown>;
  }) {
    if (!Object.values(MigrationMode).includes(input.mode as MigrationMode)) {
      const err: any = new Error(`Unknown migration mode '${input.mode}'`);
      err.statusCode = 400;
      err.code = 'INVALID_MODE';
      throw err;
    }
    const runId = input.runId ?? `MIG-${input.legalEntityId}-${input.mode}-${Date.now()}`;

    // Restartable + idempotent: re-issuing the same runId returns the
    // existing run rather than creating a second one.
    const existing = await this.runs.findByRunId(input.tenantId, runId);
    if (existing) return existing;

    const run = await this.runs.create({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      runId,
      mode: input.mode,
      transformationVersion: input.transformationVersion,
      sourceSnapshotRef: input.sourceSnapshotRef ?? null,
      createdBy: input.actor,
      metadata: input.metadata,
    });
    await this.runs.appendAudit({
      tenantId: input.tenantId,
      runId,
      action: 'RUN_CREATED',
      actor: input.actor,
      toState: MigrationState.DISCOVERED,
      evidence: { mode: input.mode, transformationVersion: input.transformationVersion },
    });
    await this.events.publishMigrationEvent(MIGRATION_EVENTS.RUN_CREATED, input.tenantId, {
      runId, legalEntityId: input.legalEntityId, mode: input.mode, actor: input.actor,
    });
    return run;
  }

  list(tenantId: string, filters: { legalEntityId?: string; state?: string; mode?: string }) {
    return this.runs.list(tenantId, filters);
  }

  async get(tenantId: string, runId: string) {
    const run = await this.runs.findByRunId(tenantId, runId);
    if (!run) throw new MigrationRunNotFoundError(runId);
    return run;
  }

  async getAudit(tenantId: string, runId: string) {
    await this.get(tenantId, runId);
    return this.runs.listAudit(tenantId, runId);
  }

  /** Declares the legacy source freeze — an attestation, not a schedule. */
  async attestFreeze(tenantId: string, runId: string, actor: string, attestation: string) {
    const run = await this.get(tenantId, runId);
    if (!attestation || attestation.trim().length < 10) {
      const err: any = new Error('A freeze attestation statement is required');
      err.statusCode = 400;
      err.code = 'FREEZE_ATTESTATION_REQUIRED';
      throw err;
    }
    const updated = await this.runs.patch(tenantId, runId, { frozenAt: new Date(), freezeAttestedBy: actor });
    await this.runs.appendAudit({
      tenantId, runId, action: 'FREEZE_ATTESTED', actor,
      fromState: run.state, toState: run.state, reason: attestation,
    });
    return updated;
  }

  /**
   * Assembles the readiness evidence from persisted facts only. Nothing here
   * is assumed: an absent CE-15 signal is reported as not approved.
   */
  async computeReadiness(tenantId: string, runId: string, period?: { year: number; month: number }): Promise<ReadinessReport> {
    const run = await this.get(tenantId, runId);
    const [gateRows, blockingExceptions, unexplainedDiffs, allSignedOff, ceremony] = await Promise.all([
      this.gates.list(tenantId, runId),
      this.exceptions.countBlockingPending(tenantId, runId),
      this.comparisons.countUnexplained(tenantId, runId),
      this.comparisons.allPeriodsSignedOff(tenantId, runId),
      this.cutovers.find(tenantId, runId),
    ]);

    // Only the newest evaluation per gate code counts — gates are re-evaluated
    // after every correction, and a stale FAIL must not outlive its fix.
    const latestByGate = new Map<string, any>();
    for (const row of gateRows as any[]) {
      if (!latestByGate.has(row.gateCode)) latestByGate.set(row.gateCode, row);
    }
    const latest = [...latestByGate.values()];
    const gatesPassed = latest.length >= 5 && allGatesPassed(latest);

    const metadata = (run.metadata ?? {}) as Record<string, unknown>;
    const periodYear = period?.year ?? Number(metadata['conversionPeriodYear'] ?? new Date().getUTCFullYear());
    const periodMonth = period?.month ?? Number(metadata['conversionPeriodMonth'] ?? 1);
    const ce15 = await this.closeReadiness.getReadiness(tenantId, run.legalEntityId, periodYear, periodMonth);

    // Persist evidence — immutable, append-only. Stale evidence does not
    // authorise cutover; the service layer enforces the 1-hour window.
    await this.closeReadiness.persistEvidence(tenantId, runId, ce15).catch(() => undefined);

    // Staleness check: evidence older than 1 h must not authorise cutover.
    const ce15AgeMs = ce15.capturedAt ? Date.now() - ce15.capturedAt.getTime() : null;
    const ce15Stale = ce15AgeMs !== null && ce15AgeMs > CE15_EVIDENCE_MAX_AGE_MS;

    // A reopened period or stale evidence invalidates approval.
    const ce15ReadinessApproved = ce15.approved && !ce15Stale && !ce15.reopenPending;

    const readiness: CutoverReadinessInput = {
      allGatesPassed: gatesPassed,
      unexplainedDiffs,
      blockingExceptions,
      freezeDeclared: Boolean(run.frozenAt),
      deltaExtractionComplete: Boolean(metadata['deltaExtractionComplete']),
      allComparisonPeriodsSignedOff: allSignedOff,
      ce15ReadinessApproved,
      backupRestoreEvidence: Boolean(ceremony && Object.keys((ceremony as any).backupEvidence ?? {}).length > 0),
      rollbackPlanDemonstrated: Boolean(ceremony && Object.keys((ceremony as any).rollbackPlanEvidence ?? {}).length > 0),
    };
    const unmet = evaluateCutoverReadiness(readiness);
    return {
      ...readiness,
      unmet,
      ready: unmet.length === 0,
      ce15Detail: ce15.detail,
      ce15EvidenceAge: ce15AgeMs,
      ce15CloseState: ce15.closeState ?? null,
      ce15Stale,
    };
  }

  async transition(tenantId: string, runId: string, toState: string, actor: string, reason?: string) {
    const run = await this.get(tenantId, runId);
    const from = run.state as MigrationState;
    const to = toState as MigrationState;

    let readiness: CutoverReadinessInput | undefined;
    if (to === MigrationState.READY_FOR_CUTOVER) {
      readiness = await this.computeReadiness(tenantId, runId);
    }

    let cutoverApproval: { preparedBy: string; approvedBy: string | null } | undefined;
    if (to === MigrationState.CUTOVER_IN_PROGRESS) {
      const ceremony: any = await this.cutovers.find(tenantId, runId);
      cutoverApproval = {
        preparedBy: ceremony?.preparedBy ?? run.preparedBy ?? actor,
        approvedBy: ceremony?.approverIdentity ?? run.approvedBy ?? null,
      };
    }

    const next = applyMigrationTransition(from, to, { actor, readiness, cutoverApproval });
    const patch: Record<string, unknown> = {};
    if (next === MigrationState.CUTOVER_IN_PROGRESS) patch['startedAt'] = new Date();
    if (next === MigrationState.CUTOVER_COMPLETE) patch['completedAt'] = new Date();
    if (next === MigrationState.ROLLED_BACK) patch['rolledBackAt'] = new Date();

    const updated = await this.runs.updateState(tenantId, runId, next, patch);
    await this.runs.appendAudit({
      tenantId, runId, action: 'STATE_TRANSITION', actor, fromState: from, toState: next,
      reason: reason ?? null, evidence: readiness ? { readiness } : {},
    });
    await this.events.publishMigrationEvent(MIGRATION_EVENTS.RUN_STATE_CHANGED, tenantId, {
      runId, fromState: from, toState: next, actor,
    });
    return updated;
  }

  async markDeltaComplete(tenantId: string, runId: string, actor: string, deltaSnapshotRef: string) {
    const run = await this.get(tenantId, runId);
    const metadata = { ...((run.metadata ?? {}) as Record<string, unknown>), deltaExtractionComplete: true, deltaSnapshotRef };
    const updated = await this.runs.patch(tenantId, runId, { metadata: metadata as any });
    await this.runs.appendAudit({
      tenantId, runId, action: 'DELTA_EXTRACTION_COMPLETE', actor, evidence: { deltaSnapshotRef },
    });
    return updated;
  }
}

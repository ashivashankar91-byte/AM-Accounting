import { inject, injectable } from 'tsyringe';
import {
  IComparisonRepository, IStagingRepository, IMigrationRunRepository, IConsolidationHistoryProvider,
} from '../domain/interfaces';
import {
  computeDiffs, summarize, validateSignOff, ComparableFigure, ClassifiedDiff,
  DiffClassification, EXPLAINED_CLASSIFICATIONS,
} from '../domain/parallel-run-comparator';
import { MigrationState } from '../domain/migration-state-machine';

export class ComparisonNotFoundError extends Error {
  readonly code = 'COMPARISON_NOT_FOUND';
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Comparison run ${id} not found`);
    this.name = 'ComparisonNotFoundError';
  }
}

@injectable()
export class ComparisonService {
  constructor(
    @inject('IComparisonRepository') private readonly repo: IComparisonRepository,
    @inject('IStagingRepository') private readonly staging: IStagingRepository,
    @inject('IMigrationRunRepository') private readonly runs: IMigrationRunRepository,
    @inject('IConsolidationHistoryProvider') private readonly history: IConsolidationHistoryProvider,
  ) {}

  list(tenantId: string, runId: string) {
    return this.repo.list(tenantId, runId);
  }

  /**
   * Ingests the legacy-side period figures and compares them with the modern
   * equivalents derived from this run's staged datasets.
   *
   * The exit criterion is not "zero differences" — it is that every difference
   * is classified and dispositioned, so unexplained ones stay visible.
   */
  async createComparison(input: {
    tenantId: string; legalEntityId: string; runId: string; periodYear: number; periodMonth: number;
    legacyFigures: ComparableFigure[]; modernFigures?: ComparableFigure[];
    legacySnapshotRef?: string | null; actor: string;
  }) {
    const run = await this.runs.findByRunId(input.tenantId, input.runId);
    if (!run) {
      const err: any = new Error(`Migration run ${input.runId} not found`);
      err.statusCode = 404;
      err.code = 'RUN_NOT_FOUND';
      throw err;
    }

    const modern = input.modernFigures ?? (await this.deriveModernFigures(input.tenantId, input.runId));
    const version = await this.repo.nextVersion(input.tenantId, input.runId, input.periodYear, input.periodMonth);

    const comparison = await this.repo.create({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      runId: input.runId,
      periodYear: input.periodYear,
      periodMonth: input.periodMonth,
      legacySnapshotRef: input.legacySnapshotRef ?? null,
      operatorId: input.actor,
      comparisonVersion: version,
    });

    const diffs = computeDiffs(input.legacyFigures, modern);
    await this.repo.insertDiffs(
      input.tenantId, comparison.id,
      diffs.map((d) => ({
        diffType: d.diffType, dimension: d.dimension,
        sourceValue: d.sourceValue, targetValue: d.targetValue, variance: d.variance,
        classification: 'UNEXPLAINED',
      })),
    );
    await this.repo.updateRun(input.tenantId, comparison.id, {
      totalDiffs: diffs.length,
      unexplainedDiffs: diffs.length,
      state: diffs.length === 0 ? 'COMPLETE' : 'PENDING',
    });

    const consolidation = await this.history.getHistory(input.tenantId, input.legalEntityId, input.periodYear);
    return {
      comparisonRunId: comparison.id,
      comparisonVersion: version,
      totalDiffs: diffs.length,
      unexplainedDiffs: diffs.length,
      modernFigureCount: modern.length,
      legacyFigureCount: input.legacyFigures.length,
      consolidationHistory: consolidation,
    };
  }

  /** Modern-side figures come from the run's own converted TB, never re-keyed. */
  async deriveModernFigures(tenantId: string, runId: string): Promise<ComparableFigure[]> {
    const datasets = await this.staging.listDatasets(tenantId, runId);
    const figures: ComparableFigure[] = [];

    for (const dataset of datasets as any[]) {
      const rows = await this.staging.listRows(tenantId, dataset.id, 100000, 0);
      if (dataset.datasetType === 'TB' || dataset.datasetType === 'BEGINNING_BALANCES') {
        const byAccount = new Map<string, number>();
        for (const row of rows as any[]) {
          const data = row.stagedData as Record<string, unknown>;
          const account = String(data['accountCode'] ?? '');
          if (!account) continue;
          const net = Number(data['debit'] ?? 0) - Number(data['credit'] ?? 0);
          byAccount.set(account, Math.round(((byAccount.get(account) ?? 0) + net) * 100) / 100);
        }
        for (const [dimension, value] of byAccount) figures.push({ diffType: 'TB_ACCOUNT', dimension, value });
      } else if (dataset.datasetType === 'OPEN_ITEMS' || dataset.datasetType === 'SCHEDULES') {
        const byControl = new Map<string, number>();
        for (const row of rows as any[]) {
          const data = row.stagedData as Record<string, unknown>;
          const control = String(data['controlAccount'] ?? data['accountCode'] ?? '');
          if (!control) continue;
          const amount = Number(data['openItemAmount'] ?? data['amount'] ?? 0);
          byControl.set(control, Math.round(((byControl.get(control) ?? 0) + amount) * 100) / 100);
        }
        for (const [dimension, value] of byControl) figures.push({ diffType: 'SCHEDULE_CONTROL', dimension, value });
      } else if (dataset.datasetType === 'STATEMENTS' || dataset.datasetType === 'COMPARATIVE') {
        const byLine = new Map<string, number>();
        for (const row of rows as any[]) {
          const data = row.stagedData as Record<string, unknown>;
          const line = String(data['statementLine'] ?? data['accountCode'] ?? '');
          if (!line) continue;
          const amount = Number(data['amount'] ?? Number(data['debit'] ?? 0) - Number(data['credit'] ?? 0));
          byLine.set(line, Math.round(((byLine.get(line) ?? 0) + amount) * 100) / 100);
        }
        for (const [dimension, value] of byLine) figures.push({ diffType: 'STATEMENT_LINE', dimension, value });
      }
    }
    return figures;
  }

  async getComparison(tenantId: string, comparisonRunId: string) {
    const comparison = await this.repo.find(tenantId, comparisonRunId);
    if (!comparison) throw new ComparisonNotFoundError(comparisonRunId);
    const diffs = await this.repo.listDiffs(tenantId, comparisonRunId);
    return { comparison, diffs, summary: summarize(this.toClassified(diffs)) };
  }

  private toClassified(diffs: any[]): ClassifiedDiff[] {
    return diffs.map((d) => ({
      classification: d.classification as DiffClassification,
      reason: d.reason ?? null,
      disposition: d.disposition as 'PENDING' | 'APPROVED',
    }));
  }

  /**
   * Classifies a difference. A classification other than UNEXPLAINED must
   * carry a reason — that reason is the explanation the exit criterion is
   * actually asking for.
   */
  async classifyDiff(input: {
    tenantId: string; comparisonRunId: string; diffId: string; classification: string;
    reason: string; actor: string;
    /**
     * A reviewer may classify a difference without yet accepting it. Omitted,
     * an explained classification is dispositioned in the same act; passing
     * PENDING keeps it visible as outstanding work.
     */
    disposition?: string;
  }) {
    const diff = await this.repo.findDiff(input.tenantId, input.diffId);
    if (!diff) {
      const err: any = new Error(`Comparison difference ${input.diffId} not found`);
      err.statusCode = 404;
      err.code = 'DIFF_NOT_FOUND';
      throw err;
    }
    const classification = input.classification as DiffClassification;
    if (![...EXPLAINED_CLASSIFICATIONS, 'UNEXPLAINED'].includes(classification)) {
      const err: any = new Error(`classification must be one of ${[...EXPLAINED_CLASSIFICATIONS, 'UNEXPLAINED'].join(', ')}`);
      err.statusCode = 400;
      err.code = 'INVALID_CLASSIFICATION';
      throw err;
    }
    if (classification !== 'UNEXPLAINED' && (!input.reason || input.reason.trim().length < 5)) {
      const err: any = new Error('An explanation is required when classifying a difference as explained');
      err.statusCode = 400;
      err.code = 'EXPLANATION_REQUIRED';
      throw err;
    }

    if (input.disposition && !['PENDING', 'APPROVED'].includes(input.disposition)) {
      const err: any = new Error('disposition must be PENDING or APPROVED');
      err.statusCode = 400;
      err.code = 'INVALID_DISPOSITION';
      throw err;
    }

    const approved = classification !== 'UNEXPLAINED' && (input.disposition ?? 'APPROVED') === 'APPROVED';
    const updated = await this.repo.updateDiff(input.tenantId, input.diffId, {
      classification,
      reason: input.reason,
      classifiedBy: input.actor,
      classifiedAt: new Date(),
      disposition: approved ? 'APPROVED' : 'PENDING',
      approvedBy: approved ? input.actor : null,
      approvedAt: approved ? new Date() : null,
    });

    const diffs = await this.repo.listDiffs(input.tenantId, input.comparisonRunId);
    const summary = summarize(this.toClassified(diffs));
    await this.repo.updateRun(input.tenantId, input.comparisonRunId, {
      totalDiffs: summary.totalDiffs,
      unexplainedDiffs: summary.unexplainedDiffs,
      state: summary.unexplainedDiffs === 0 ? 'COMPLETE' : 'PENDING',
    });
    return { diff: updated, summary };
  }

  /**
   * Controller sign-off for the period. The operator who ran the comparison
   * may not sign it off, and a single unexplained difference blocks the
   * signature entirely.
   */
  async signOff(input: { tenantId: string; comparisonRunId: string; actor: string; evidence?: Record<string, unknown> }) {
    const comparison = await this.repo.find(input.tenantId, input.comparisonRunId);
    if (!comparison) throw new ComparisonNotFoundError(input.comparisonRunId);
    const diffs = await this.repo.listDiffs(input.tenantId, input.comparisonRunId);

    const summary = validateSignOff({
      operatorId: comparison.operatorId,
      signerId: input.actor,
      diffs: this.toClassified(diffs),
    });

    const updated = await this.repo.updateRun(input.tenantId, input.comparisonRunId, {
      state: 'SIGNED_OFF',
      signedOffBy: input.actor,
      signedOffAt: new Date(),
      signedOffEvidence: { ...(input.evidence ?? {}), summary } as any,
      unexplainedDiffs: 0,
      totalDiffs: summary.totalDiffs,
    });

    const allSignedOff = await this.repo.allPeriodsSignedOff(input.tenantId, comparison.runId);
    if (allSignedOff) {
      const run = await this.runs.findByRunId(input.tenantId, comparison.runId);
      if (run && run.state === MigrationState.VALIDATED) {
        await this.runs.updateState(input.tenantId, comparison.runId, MigrationState.RECONCILED);
      }
    }
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: comparison.runId, action: 'COMPARISON_SIGNED_OFF', actor: input.actor,
      evidence: { comparisonRunId: input.comparisonRunId, summary },
    });
    return { comparison: updated, summary, cutoverRecommended: allSignedOff };
  }
}

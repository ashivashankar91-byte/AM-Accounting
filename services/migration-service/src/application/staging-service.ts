import { inject, injectable } from 'tsyringe';
import {
  IStagingRepository, ISourceRepository, IExceptionRepository, IGateRepository,
  IControlTotalRepository, IMigrationRunRepository, IEventPublisherPort, ILineageRepository,
} from '../domain/interfaces';
import { MappingService } from './mapping-service';
import { transform, TransformResult, MappingSetNotFrozenError } from '../domain/transformation-engine';
import { computeControlTotals, comparePhases, ControlTotalSnapshot } from '../domain/control-total-calculator';
import { evaluateAllGates, StagedItem, GateEvaluation } from '../domain/gate-evaluator';
import { MigrationState } from '../domain/migration-state-machine';
import { MIGRATION_EVENTS } from '../infrastructure/migration-event-publisher';
import { maskRecords } from '../domain/sensitive-data-masker';

export const DATASET_TYPES = [
  'TB', 'OPEN_ITEMS', 'SCHEDULES', 'BANK_REC', 'PAYROLL', 'VEHICLE', 'OEM',
  'JOURNAL_HISTORY', 'BEGINNING_BALANCES', 'COMPARATIVE', 'STATEMENTS', 'CONFIG', 'ATTACHMENTS',
] as const;

export type DatasetType = (typeof DATASET_TYPES)[number];

/**
 * Dataset types whose rows are individual open items. Only these carry
 * document dates and aging buckets, so only these are subject to S129's
 * item-level gates G1 and G4 in full.
 */
export const ITEM_LEVEL_DATASET_TYPES: string[] = ['OPEN_ITEMS', 'SCHEDULES'];

export class UnknownDatasetTypeError extends Error {
  readonly code = 'UNKNOWN_DATASET_TYPE';
  readonly statusCode = 400;
  constructor(value: string) {
    super(`Unknown datasetType '${value}'. Expected one of: ${DATASET_TYPES.join(', ')}`);
    this.name = 'UnknownDatasetTypeError';
  }
}

export interface StageInput {
  tenantId: string;
  legalEntityId: string;
  runId: string;
  snapshotId: string;
  mappingSetId: string;
  datasetType: string;
  actor: string;
}


/**
 * A subledger dataset ties to the control accounts it actually covers. Holding
 * an AR open-item batch against the cash or equity balance would be a
 * meaningless comparison, so G2 is scoped to the accounts in play — while an
 * item pointing at an account with no converted balance still breaches, because
 * its balance resolves to zero.
 */
function scopeToCoveredControlAccounts(
  balances: Record<string, number>,
  items: StagedItem[],
): Record<string, number> {
  const covered = new Set(items.map((i) => i.controlAccount).filter(Boolean));
  const scoped: Record<string, number> = {};
  for (const account of covered) scoped[account] = balances[account] ?? 0;
  return scoped;
}

@injectable()
export class StagingService {
  constructor(
    @inject('IStagingRepository') private readonly staging: IStagingRepository,
    @inject('ISourceRepository') private readonly sources: ISourceRepository,
    @inject('IExceptionRepository') private readonly exceptions: IExceptionRepository,
    @inject('IGateRepository') private readonly gates: IGateRepository,
    @inject('IControlTotalRepository') private readonly controlTotals: IControlTotalRepository,
    @inject('ILineageRepository') private readonly lineage: ILineageRepository,
    @inject('IMigrationRunRepository') private readonly runs: IMigrationRunRepository,
    @inject('IEventPublisherPort') private readonly events: IEventPublisherPort,
    private readonly mappings: MappingService,
  ) {}

  private assertDatasetType(value: string): DatasetType {
    if (!(DATASET_TYPES as readonly string[]).includes(value)) throw new UnknownDatasetTypeError(value);
    return value as DatasetType;
  }

  /**
   * Dry-run transformation preview. Nothing is written — this is what an
   * operator inspects before committing a stage, including the exceptions the
   * real run would raise.
   */
  async preview(input: {
    tenantId: string; snapshotId: string; mappingSetId: string; limit: number; allowSensitive: boolean;
  }) {
    const pinned = await this.mappings.loadPinned(input.tenantId, input.mappingSetId);
    const rows = await this.sources.listRowsBySnapshot(input.tenantId, input.snapshotId, input.limit);
    const result = transform(
      (rows as any[]).map((r) => ({ id: r.id, rowIndex: r.rowIndex, rawData: r.rawData as Record<string, unknown> })),
      pinned,
      { requireFrozen: false },
    );
    return {
      transformationVersion: result.transformationVersion,
      mappingSetStatus: pinned.status,
      previewedRows: rows.length,
      transformedCount: result.rows.length,
      exceptionCount: result.exceptions.length,
      rows: result.rows.slice(0, input.limit).map((r) => ({
        sourceRowId: r.sourceRowId,
        rowHash: r.rowHash,
        stagedData: maskRecords([r.stagedData], { allowSensitive: input.allowSensitive })[0],
        validationErrors: r.validationErrors,
        lineageRef: r.lineageRef,
      })),
      exceptions: result.exceptions.slice(0, input.limit),
    };
  }

  /**
   * Stages a dataset. The mapping set must be FROZEN — staging from a draft
   * would break the version-pinning guarantee that makes a run reproducible.
   */
  async stage(input: StageInput) {
    const datasetType = this.assertDatasetType(input.datasetType);
    const run = await this.runs.findByRunId(input.tenantId, input.runId);
    if (!run) {
      const err: any = new Error(`Migration run ${input.runId} not found`);
      err.statusCode = 404;
      err.code = 'RUN_NOT_FOUND';
      throw err;
    }

    const pinned = await this.mappings.loadPinned(input.tenantId, input.mappingSetId);
    if (pinned.status !== 'FROZEN') throw new MappingSetNotFrozenError(input.mappingSetId);

    const sourceRows = await this.sources.listRowsBySnapshot(input.tenantId, input.snapshotId);
    const extractTotals = computeControlTotals('EXTRACT', (sourceRows as any[]).map((r) => ({ stagedData: r.rawData })));
    await this.controlTotals.capture(input.tenantId, input.runId, null, extractTotals);

    const result: TransformResult = transform(
      (sourceRows as any[]).map((r) => ({ id: r.id, rowIndex: r.rowIndex, rawData: r.rawData as Record<string, unknown> })),
      pinned,
    );

    const dataset = await this.staging.upsertDataset({
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      runId: input.runId,
      datasetType,
      transformationVersion: result.transformationVersion,
      mappingSetId: input.mappingSetId,
      sourceRef: input.snapshotId,
    });

    const inserted = await this.staging.insertRows({
      tenantId: input.tenantId,
      stagingDatasetId: dataset.id,
      rows: result.rows.map((r) => ({
        sourceRowId: r.sourceRowId,
        rowHash: r.rowHash,
        stagedData: r.stagedData,
        validationErrors: r.validationErrors,
        lineageRef: r.lineageRef,
      })),
    });

    if (result.exceptions.length > 0) {
      await this.exceptions.create(
        result.exceptions.map((e) => ({
          tenantId: input.tenantId,
          legalEntityId: input.legalEntityId,
          runId: input.runId,
          exceptionType: e.exceptionType,
          reason: e.reason,
          sourceRowId: e.sourceRowId,
          sourceField: e.sourceField,
          sourceValue: e.sourceValue,
          blocking: true,
          evidence: e.evidence,
        })),
      );
    }

    const stagedRows = await this.staging.listRows(input.tenantId, dataset.id, 100000, 0);

    // Lineage is opened at stage time, not at promotion time — a row that never
    // gets promoted still needs a traceable path from its source row. Promotion
    // later attaches the target side to this same row.
    const snapshot = await this.sources.findSnapshot(input.tenantId, input.snapshotId);
    const stagingIdByHash = new Map((stagedRows as any[]).map((r) => [r.rowHash, r.id]));
    const fileIdBySourceRow = new Map((sourceRows as any[]).map((r) => [r.id, r.sourceFileId]));
    await this.lineage.record(
      result.rows
        .filter((r) => stagingIdByHash.has(r.rowHash))
        .map((r) => ({
          tenantId: input.tenantId,
          runId: input.runId,
          sourceSystemRef: snapshot?.sourceSystemId ?? null,
          sourceFileRef: fileIdBySourceRow.get(r.sourceRowId) ?? null,
          sourceRowRef: r.sourceRowId,
          stagingRecordId: stagingIdByHash.get(r.rowHash) ?? null,
          mappingDecisionRef: input.mappingSetId,
          transformationVersion: result.transformationVersion,
          evidence: {
            datasetType,
            mappingSetId: input.mappingSetId,
            mappingDecisionRefs: r.lineageRef.mappingDecisionRefs,
            snapshotRef: snapshot?.snapshotRef ?? input.snapshotId,
            rowHash: r.rowHash,
          },
        })),
    );
    const stagingTotals = computeControlTotals('STAGING', stagedRows as any[]);
    stagingTotals.rejectedCount = result.exceptions.length;
    stagingTotals.exceptionCount = result.exceptions.length;
    stagingTotals.duplicateCount = inserted.skippedDuplicates;
    await this.controlTotals.capture(input.tenantId, input.runId, dataset.id, stagingTotals);

    await this.staging.updateDataset(input.tenantId, dataset.id, {
      state: 'STAGED',
      rowCount: stagedRows.length,
      acceptedCount: stagingTotals.acceptedCount,
      rejectedCount: result.exceptions.length,
      skippedCount: inserted.skippedDuplicates,
      totalDebit: stagingTotals.totalDebit,
      totalCredit: stagingTotals.totalCredit,
      controlChecksum: `${stagingTotals.acceptedCount}:${stagingTotals.totalDebit}:${stagingTotals.totalCredit}`,
    });

    await this.mappings.markUsed(input.tenantId, input.mappingSetId, input.runId);
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: input.runId, action: 'STAGED', actor: input.actor,
      evidence: { datasetType, inserted: inserted.inserted, skippedDuplicates: inserted.skippedDuplicates, exceptions: result.exceptions.length },
    });
    if (run.state === MigrationState.DISCOVERED || run.state === MigrationState.MAPPED) {
      await this.runs.updateState(input.tenantId, input.runId, MigrationState.STAGED);
    }
    await this.events.publishMigrationEvent(MIGRATION_EVENTS.STAGING_COMPLETE, input.tenantId, {
      runId: input.runId, datasetType, inserted: inserted.inserted, skippedDuplicates: inserted.skippedDuplicates,
    });

    return {
      datasetId: dataset.id,
      datasetType,
      transformationVersion: result.transformationVersion,
      inserted: inserted.inserted,
      skippedDuplicates: inserted.skippedDuplicates,
      exceptions: result.exceptions.length,
      controlTotals: stagingTotals,
      phaseReconciliation: comparePhases(extractTotals, stagingTotals),
    };
  }

  listDatasets(tenantId: string, runId: string) {
    return this.staging.listDatasets(tenantId, runId);
  }

  async listRows(tenantId: string, datasetId: string, limit: number, offset: number, allowSensitive: boolean) {
    const rows = await this.staging.listRows(tenantId, datasetId, limit, offset);
    const total = await this.staging.countRows(tenantId, datasetId);
    return {
      total,
      items: (rows as any[]).map((r) => ({
        ...r,
        stagedData: maskRecords([r.stagedData as Record<string, unknown>], { allowSensitive })[0],
      })),
    };
  }

  /**
   * Runs gates G1–G5 over every staged dataset in the run and records the
   * results as evidence. Validation never mutates staged data: it only
   * produces gate results and control totals.
   */
  async validate(input: {
    tenantId: string; runId: string; actor: string;
    convertedControlBalances?: Record<string, number>;
    agingAsOf?: string | null;
  }) {
    const run = await this.runs.findByRunId(input.tenantId, input.runId);
    if (!run) {
      const err: any = new Error(`Migration run ${input.runId} not found`);
      err.statusCode = 404;
      err.code = 'RUN_NOT_FOUND';
      throw err;
    }

    const datasets = await this.staging.listDatasets(input.tenantId, input.runId);
    const exceptions = await this.exceptions.list(input.tenantId, input.runId);
    const exceptionInput = (exceptions as any[]).map((e) => ({ blocking: e.blocking, disposition: e.disposition }));

    // Control balances default to the converted TB dataset's own account
    // totals — G2 must compare items against the TB the same run produced,
    // never against a number typed in by the operator.
    const controlBalances = input.convertedControlBalances ?? (await this.deriveControlBalances(input.tenantId, input.runId));

    // An explicit null means "no as-of date was supplied", which G4 must
    // report as BLOCKED rather than silently aging against today.
    const agingAsOf = 'agingAsOf' in input ? (input.agingAsOf ?? null) : new Date().toISOString().slice(0, 10);

    const perDataset: { datasetId: string; datasetType: string; gates: GateEvaluation[] }[] = [];
    for (const dataset of datasets as any[]) {
      const rows = await this.staging.listRows(input.tenantId, dataset.id, 100000, 0);
      const items: StagedItem[] = (rows as any[]).map((r) => {
        const data = r.stagedData as Record<string, unknown>;
        return {
          sourceIdentity: String(data['sourceIdentity'] ?? r.rowHash),
          controlAccount: String(data['controlAccount'] ?? data['accountCode'] ?? ''),
          amount: Number(data['openItemAmount'] ?? data['amount'] ?? Number(data['debit'] ?? 0) - Number(data['credit'] ?? 0)),
          documentDate: (data['documentDate'] as string | undefined) ?? null,
          dueDate: (data['dueDate'] as string | undefined) ?? null,
          agingBucket: (data['agingBucket'] as string | undefined) ?? null,
          validationErrors: (r.validationErrors as string[] | undefined) ?? [],
          alreadyPromoted: r.state === 'PROMOTED',
        };
      });

      const itemLevel = ITEM_LEVEL_DATASET_TYPES.includes(dataset.datasetType);
      const gates = evaluateAllGates({
        items,
        itemLevel,
        convertedControlBalances: itemLevel
          ? scopeToCoveredControlAccounts(controlBalances, items)
          : this.controlBalancesFromItems(items),
        agingAsOf,
        exceptions: exceptionInput,
      });

      await this.gates.record(input.tenantId, input.runId, dataset.id, gates, input.actor);
      perDataset.push({ datasetId: dataset.id, datasetType: dataset.datasetType, gates });

      const totals = computeControlTotals('TRANSFORM', rows as any[]);
      await this.controlTotals.capture(input.tenantId, input.runId, dataset.id, totals);
      await this.staging.updateDataset(input.tenantId, dataset.id, {
        state: gates.every((g) => g.result === 'PASS') ? 'VALIDATED' : 'STAGED',
      });
    }

    const allPassed = perDataset.length > 0 && perDataset.every((d) => d.gates.every((g) => g.result === 'PASS'));
    if (allPassed && (run.state === MigrationState.STAGED || run.state === MigrationState.MAPPED)) {
      await this.runs.updateState(input.tenantId, input.runId, MigrationState.VALIDATED);
    }
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: input.runId, action: 'VALIDATED', actor: input.actor,
      evidence: { datasets: perDataset.length, allPassed },
    });
    await this.events.publishMigrationEvent(MIGRATION_EVENTS.VALIDATION_COMPLETE, input.tenantId, {
      runId: input.runId, allPassed, datasets: perDataset.length,
    });

    return { allPassed, datasets: perDataset };
  }

  private controlBalancesFromItems(items: StagedItem[]): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const item of items) {
      totals[item.controlAccount] = Math.round(((totals[item.controlAccount] ?? 0) + item.amount) * 100) / 100;
    }
    return totals;
  }

  /** Derives control balances from the run's own converted TB dataset. */
  async deriveControlBalances(tenantId: string, runId: string): Promise<Record<string, number>> {
    const tb = await this.staging.findDataset(tenantId, runId, 'TB');
    if (!tb) return {};
    const rows = await this.staging.listRows(tenantId, tb.id, 100000, 0);
    const totals: Record<string, number> = {};
    for (const row of rows as any[]) {
      const data = row.stagedData as Record<string, unknown>;
      const account = String(data['accountCode'] ?? data['controlAccount'] ?? '');
      if (!account) continue;
      const net = Number(data['debit'] ?? 0) - Number(data['credit'] ?? 0);
      totals[account] = Math.round(((totals[account] ?? 0) + net) * 100) / 100;
    }
    return totals;
  }

  listGates(tenantId: string, runId: string) {
    return this.gates.list(tenantId, runId);
  }

  listControlTotals(tenantId: string, runId: string) {
    return this.controlTotals.list(tenantId, runId);
  }

  async capturePhase(tenantId: string, runId: string, datasetId: string | null, snapshot: ControlTotalSnapshot) {
    return this.controlTotals.capture(tenantId, runId, datasetId, snapshot);
  }
}

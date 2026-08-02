import { inject, injectable } from 'tsyringe';
import {
  IStagingRepository, ILineageRepository, IMigrationRunRepository, IExceptionRepository,
  IPostingClient, IScheduleClient, IUpstreamTargetClient, IControlTotalRepository,
  GovernedPostingRequest, PENDING_UPSTREAM,
} from '../domain/interfaces';
import { assertConserved, computeControlTotals, UnbalancedConversionBatchError } from '../domain/control-total-calculator';
import { MigrationState } from '../domain/migration-state-machine';
import { maskRecord } from '../domain/sensitive-data-masker';

export class PromotionBlockedError extends Error {
  readonly code: string;
  readonly statusCode = 422;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'PromotionBlockedError';
  }
}

export interface PromotionResult {
  datasetId: string;
  datasetType: string;
  status: 'POSTED' | 'ESTABLISHED' | 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' | 'REJECTED' | 'ALREADY_PROMOTED';
  postingExecutionRef?: string | null;
  journalRef?: string | null;
  openItemRefs?: { sourceIdentity: string; openItemRef: string }[];
  promotedRows: number;
  reason?: string;
}

/** Dataset types whose promotion goes through CE-07 governed posting. */
const FINANCIAL_DATASETS = new Set(['TB', 'BEGINNING_BALANCES', 'JOURNAL_HISTORY', 'COMPARATIVE']);
/** Dataset types whose promotion goes through the CE-08 schedule contract. */
const OPEN_ITEM_DATASETS = new Set(['OPEN_ITEMS', 'SCHEDULES']);
/** Dataset types owned by upstream modules not yet technically reconciled. */
const UPSTREAM_DATASETS: Record<string, string> = {
  BANK_REC: 'CE-09',
  PAYROLL: 'CE-13',
  VEHICLE: 'CE-12',
  OEM: 'CE-14',
};

@injectable()
export class PromotionService {
  constructor(
    @inject('IStagingRepository') private readonly staging: IStagingRepository,
    @inject('ILineageRepository') private readonly lineage: ILineageRepository,
    @inject('IMigrationRunRepository') private readonly runs: IMigrationRunRepository,
    @inject('IExceptionRepository') private readonly exceptions: IExceptionRepository,
    @inject('IControlTotalRepository') private readonly controlTotals: IControlTotalRepository,
    @inject('IPostingClient') private readonly posting: IPostingClient,
    @inject('IScheduleClient') private readonly schedules: IScheduleClient,
    @inject('IUpstreamTargetClient') private readonly upstream: IUpstreamTargetClient,
  ) {}

  /**
   * Promotes every staged dataset in the run.
   *
   * Nothing here writes to a production GL or schedule table. Financial data
   * leaves staging only as a conversion transaction handed to CE-07, and open
   * items only through the CE-08 establishment contract; the references those
   * services return are what get written back as lineage.
   */
  async promote(input: {
    tenantId: string; legalEntityId: string; runId: string; actor: string; businessDate?: string;
  }): Promise<{ results: PromotionResult[]; anyPending: boolean }> {
    const run = await this.runs.findByRunId(input.tenantId, input.runId);
    if (!run) {
      const err: any = new Error(`Migration run ${input.runId} not found`);
      err.statusCode = 404;
      err.code = 'RUN_NOT_FOUND';
      throw err;
    }
    if (run.state === MigrationState.DISCOVERED || run.state === MigrationState.MAPPED) {
      throw new PromotionBlockedError(
        `Run ${input.runId} must be staged and validated before promotion (currently ${run.state})`,
        'RUN_NOT_VALIDATED',
      );
    }

    const blocking = await this.exceptions.countBlockingPending(input.tenantId, input.runId);
    if (blocking > 0) {
      throw new PromotionBlockedError(
        `${blocking} blocking exception(s) are still pending disposition; promotion is refused`,
        'BLOCKING_EXCEPTIONS_PENDING',
      );
    }

    const businessDate = input.businessDate ?? new Date().toISOString().slice(0, 10);
    const datasets = await this.staging.listDatasets(input.tenantId, input.runId);
    const results: PromotionResult[] = [];

    for (const dataset of datasets as any[]) {
      if (FINANCIAL_DATASETS.has(dataset.datasetType)) {
        results.push(await this.promoteFinancial(input, dataset, businessDate));
      } else if (OPEN_ITEM_DATASETS.has(dataset.datasetType)) {
        results.push(await this.promoteOpenItems(input, dataset));
      } else if (UPSTREAM_DATASETS[dataset.datasetType]) {
        results.push(await this.promoteUpstream(input, dataset, UPSTREAM_DATASETS[dataset.datasetType]!));
      } else {
        results.push({
          datasetId: dataset.id, datasetType: dataset.datasetType, status: 'ALREADY_PROMOTED',
          promotedRows: 0, reason: 'Non-financial dataset requires no governed promotion',
        });
      }
    }

    const anyPending = results.some((r) => r.status === PENDING_UPSTREAM);
    await this.runs.appendAudit({
      tenantId: input.tenantId, runId: input.runId, action: 'PROMOTED', actor: input.actor,
      evidence: { results: results.map((r) => ({ datasetType: r.datasetType, status: r.status, journalRef: r.journalRef ?? null })) },
    });
    return { results, anyPending };
  }

  private async promoteFinancial(
    input: { tenantId: string; legalEntityId: string; runId: string; actor: string },
    dataset: any,
    businessDate: string,
  ): Promise<PromotionResult> {
    const rows = await this.staging.listRows(input.tenantId, dataset.id, 100000, 0);
    const unpromoted = (rows as any[]).filter((r) => r.state !== 'PROMOTED');
    if (unpromoted.length === 0) {
      return {
        datasetId: dataset.id, datasetType: dataset.datasetType, status: 'ALREADY_PROMOTED', promotedRows: 0,
        reason: 'All rows in this dataset were already promoted; re-promotion is a no-op',
      };
    }

    const lines = unpromoted.map((r) => {
      const data = r.stagedData as Record<string, unknown>;
      return {
        accountCode: String(data['accountCode'] ?? ''),
        debit: Number(data['debit'] ?? 0),
        credit: Number(data['credit'] ?? 0),
        description: (data['description'] as string | undefined) ?? 'CE-16 conversion',
        sourceRowRef: r.sourceRowId ?? r.rowHash,
      };
    });

    // Structural imbalance stops promotion before anything leaves staging.
    // This is deliberately thrown, not recorded as a soft failure: an
    // unbalanced conversion batch must never reach the posting engine.
    let conservation;
    try {
      conservation = assertConserved(lines);
    } catch (error) {
      if (error instanceof UnbalancedConversionBatchError) {
        await this.exceptions.create([{
          tenantId: input.tenantId, legalEntityId: input.legalEntityId, runId: input.runId,
          exceptionType: 'CONSERVATION_FAILED',
          reason: error.message,
          blocking: true,
          evidence: { ...error.result, datasetId: dataset.id },
        }]);
        throw new PromotionBlockedError(error.message, 'STRUCTURAL_IMBALANCE');
      }
      throw error;
    }

    const request: GovernedPostingRequest = {
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      runId: input.runId,
      // Same run + same dataset + same control checksum resolves to the same
      // identity, so a retried promotion cannot create a second journal.
      idempotencyIdentity: `migration-conversion:${input.runId}:${dataset.id}:${dataset.controlChecksum ?? conservation.totalDebit}`,
      businessDate,
      journalFamily: 'CONVERSION',
      memo: `CE-16 conversion journal — run ${input.runId} dataset ${dataset.datasetType}`,
      lines,
    };

    const posted = await this.posting.post(request);

    if (posted.status !== 'POSTED') {
      return {
        datasetId: dataset.id, datasetType: dataset.datasetType,
        status: posted.status, promotedRows: 0,
        postingExecutionRef: posted.postingExecutionRef, journalRef: posted.journalRef,
        reason: posted.reason ?? 'Governed posting did not complete; no rows were marked promoted',
      };
    }

    const promoted = await this.staging.markRowsPromoted(
      input.tenantId, dataset.id,
      unpromoted.map((r) => ({ rowHash: r.rowHash, promotedRecordId: posted.journalRef! })),
    );

    await this.lineage.attach(
      unpromoted.map((r) => ({
        tenantId: input.tenantId, runId: input.runId, stagingRecordId: r.id,
        targetRecordId: posted.journalRef, targetRecordType: 'JOURNAL_ENTRY',
        postingExecutionRef: posted.postingExecutionRef, journalRef: posted.journalRef,
        evidence: { journalFamily: 'CONVERSION', idempotencyIdentity: request.idempotencyIdentity },
      })),
    );

    const loadTotals = computeControlTotals('LOAD', unpromoted as any[]);
    await this.controlTotals.capture(input.tenantId, input.runId, dataset.id, loadTotals);
    await this.staging.updateDataset(input.tenantId, dataset.id, { state: 'PROMOTED' });

    return {
      datasetId: dataset.id, datasetType: dataset.datasetType, status: 'POSTED', promotedRows: promoted,
      postingExecutionRef: posted.postingExecutionRef, journalRef: posted.journalRef,
    };
  }

  private async promoteOpenItems(
    input: { tenantId: string; legalEntityId: string; runId: string; actor: string },
    dataset: any,
  ): Promise<PromotionResult> {
    const rows = await this.staging.listRows(input.tenantId, dataset.id, 100000, 0);
    const unpromoted = (rows as any[]).filter((r) => r.state !== 'PROMOTED');
    if (unpromoted.length === 0) {
      return {
        datasetId: dataset.id, datasetType: dataset.datasetType, status: 'ALREADY_PROMOTED', promotedRows: 0,
        reason: 'All open items in this dataset were already established',
      };
    }

    const byControl = new Map<string, any[]>();
    for (const row of unpromoted) {
      const data = row.stagedData as Record<string, unknown>;
      const control = String(data['controlAccount'] ?? data['accountCode'] ?? '');
      const bucket = byControl.get(control) ?? [];
      bucket.push(row);
      byControl.set(control, bucket);
    }

    const establishedRefs: { sourceIdentity: string; openItemRef: string }[] = [];
    let promotedRows = 0;

    for (const [controlAccount, bucketRows] of byControl) {
      const result = await this.schedules.establishOpenItems({
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        runId: input.runId,
        controlAccount,
        items: bucketRows.map((r) => {
          const data = r.stagedData as Record<string, unknown>;
          return {
            sourceIdentity: String(data['sourceIdentity'] ?? r.rowHash),
            documentRef: String(data['documentRef'] ?? ''),
            documentDate: String(data['documentDate'] ?? ''),
            dueDate: (data['dueDate'] as string | undefined) ?? null,
            amount: Number(data['openItemAmount'] ?? data['amount'] ?? 0),
            partyRef: (data['partyRef'] as string | undefined) ?? null,
            agingBucket: (data['agingBucket'] as string | undefined) ?? null,
            sourceRowRef: r.sourceRowId ?? r.rowHash,
            stagingRecordId: r.rowHash,
          };
        }),
      });

      if (result.status !== 'ESTABLISHED') {
        return {
          datasetId: dataset.id, datasetType: dataset.datasetType, status: result.status, promotedRows: 0,
          reason: result.reason ?? 'Schedule establishment did not complete; no items were marked migrated',
        };
      }

      const refByIdentity = new Map(result.establishedRefs.map((r) => [r.sourceIdentity, r.openItemRef]));
      const promotions: { rowHash: string; promotedRecordId: string }[] = [];
      for (const row of bucketRows) {
        const data = row.stagedData as Record<string, unknown>;
        const identity = String(data['sourceIdentity'] ?? row.rowHash);
        const ref = refByIdentity.get(identity);
        if (!ref) continue;
        promotions.push({ rowHash: row.rowHash, promotedRecordId: ref });
      }
      promotedRows += await this.staging.markRowsPromoted(input.tenantId, dataset.id, promotions);
      establishedRefs.push(...result.establishedRefs);

      await this.lineage.attach(
        bucketRows
          .filter((r) => refByIdentity.has(String((r.stagedData as any)['sourceIdentity'] ?? r.rowHash)))
          .map((r) => ({
            tenantId: input.tenantId, runId: input.runId, stagingRecordId: r.id,
            targetRecordId: refByIdentity.get(String((r.stagedData as any)['sourceIdentity'] ?? r.rowHash)) ?? null,
            targetRecordType: 'OPEN_ITEM',
            openItemRef: refByIdentity.get(String((r.stagedData as any)['sourceIdentity'] ?? r.rowHash)) ?? null,
            evidence: { controlAccount },
          })),
      );
    }

    await this.staging.updateDataset(input.tenantId, dataset.id, { state: 'PROMOTED' });
    return {
      datasetId: dataset.id, datasetType: dataset.datasetType, status: 'ESTABLISHED',
      promotedRows, openItemRefs: establishedRefs,
    };
  }

  /**
   * Datasets owned by a module whose migration API is not yet reconciled.
   * The staged data is retained and the run is told the truth; no row is
   * marked promoted and no target id is invented.
   */
  private async promoteUpstream(
    input: { tenantId: string; legalEntityId: string; runId: string; actor: string },
    dataset: any,
    moduleCode: string,
  ): Promise<PromotionResult> {
    const rows = await this.staging.listRows(input.tenantId, dataset.id, 100000, 0);
    const result = await this.upstream.migrateInto(moduleCode, {
      tenantId: input.tenantId, legalEntityId: input.legalEntityId, runId: input.runId,
      datasetType: dataset.datasetType, rowCount: rows.length,
    });
    return {
      datasetId: dataset.id, datasetType: dataset.datasetType,
      status: result.status === 'AVAILABLE' ? 'POSTED' : PENDING_UPSTREAM,
      promotedRows: 0,
      reason: result.detail,
    };
  }

  /** Journals this run produced — used by rollback and lineage drill-down. */
  async promotedEffects(tenantId: string, runId: string) {
    const lineage = await this.lineage.list(tenantId, runId);
    const journalRefs = new Set<string>();
    const openItemRefs = new Set<string>();
    const lineageByJournal: Record<string, string> = {};
    for (const entry of lineage as any[]) {
      if (entry.journalRef) {
        journalRefs.add(entry.journalRef);
        lineageByJournal[entry.journalRef] = entry.id;
      }
      if (entry.openItemRef) openItemRefs.add(entry.openItemRef);
    }
    return { journalRefs: [...journalRefs], openItemRefs: [...openItemRefs], lineageByJournal };
  }

  async listLineage(
    tenantId: string,
    runId: string,
    filters?: { sourceRowRef?: string; journalRef?: string },
    allowSensitive = true,
  ) {
    const rows = await this.lineage.list(tenantId, runId, filters);
    if (allowSensitive) return rows;
    return (rows as any[]).map((row) => ({
      ...row,
      evidence: row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
        ? maskRecord(row.evidence as Record<string, unknown>, { allowSensitive: false })
        : row.evidence,
    }));
  }
}

/**
 * In-memory implementations of every CE-16 domain port.
 *
 * These are not stubs that return canned answers — they enforce the same
 * uniqueness, tenant scoping and idempotency rules the Prisma repositories
 * enforce (row-hash uniqueness, checksum uniqueness, promoted-row protection),
 * so an integration test that passes here is exercising real service logic
 * against real constraints rather than a permissive fake.
 */

import {
  IMigrationRunRepository, ISourceRepository, IMappingRepository, IStagingRepository,
  IExceptionRepository, IGateRepository, IControlTotalRepository, ILineageRepository,
  IComparisonRepository, ICutoverRepository, IArchiveRepository, IRunbookRepository,
  IPostingClient, IScheduleClient, ICloseReadinessProvider, Ce15ReadinessEvidence,
  IConsolidationHistoryProvider,
  IUpstreamTargetClient, IEventPublisherPort, MigrationRunRecord, GovernedPostingRequest,
  GovernedPostingResult, OpenItemEstablishRequest, OpenItemEstablishResult, PENDING_UPSTREAM,
} from '../../src/domain/interfaces';
import { MigrationState } from '../../src/domain/migration-state-machine';
import { GateEvaluation } from '../../src/domain/gate-evaluator';
import { ControlTotalSnapshot } from '../../src/domain/control-total-calculator';
import { computeExceptionDedupeKey } from '../../src/domain/exception-identity';

let seq = 0;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq).padStart(6, '0')}`;
}

function scoped<T extends { tenantId: string }>(rows: T[], tenantId: string): T[] {
  return rows.filter((r) => r.tenantId === tenantId);
}

export class InMemoryRunRepository implements IMigrationRunRepository {
  runs: any[] = [];
  audit: any[] = [];

  async create(input: any): Promise<MigrationRunRecord> {
    const run = {
      id: nextId('run'),
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      runId: input.runId,
      mode: input.mode,
      state: MigrationState.DISCOVERED as string,
      sourceSnapshotRef: input.sourceSnapshotRef ?? null,
      transformationVersion: input.transformationVersion,
      frozenAt: null,
      freezeAttestedBy: null,
      preparedBy: null,
      approvedBy: null,
      approvalAt: null,
      startedAt: null,
      completedAt: null,
      rolledBackAt: null,
      createdBy: input.createdBy,
      metadata: input.metadata ?? {},
    };
    this.runs.push(run);
    return run as MigrationRunRecord;
  }

  async findByRunId(tenantId: string, runId: string) {
    return (scoped(this.runs, tenantId).find((r) => r.runId === runId) ?? null) as MigrationRunRecord | null;
  }

  async list(tenantId: string, filters: any) {
    return scoped(this.runs, tenantId).filter((r) =>
      (!filters.legalEntityId || r.legalEntityId === filters.legalEntityId) &&
      (!filters.state || r.state === filters.state) &&
      (!filters.mode || r.mode === filters.mode)) as MigrationRunRecord[];
  }

  async updateState(tenantId: string, runId: string, state: MigrationState, patch: Record<string, unknown> = {}) {
    const run = await this.findByRunId(tenantId, runId);
    if (!run) throw new Error(`run ${runId} not found`);
    Object.assign(run, { state }, patch);
    return run;
  }

  async patch(tenantId: string, runId: string, patch: Record<string, unknown>) {
    const run = await this.findByRunId(tenantId, runId);
    if (!run) throw new Error(`run ${runId} not found`);
    Object.assign(run, patch);
    return run;
  }

  async appendAudit(input: any) {
    this.audit.push({ id: nextId('audit'), createdAt: new Date(), ...input });
  }

  async listAudit(tenantId: string, runId: string) {
    return scoped(this.audit, tenantId).filter((a) => a.runId === runId);
  }
}

export class InMemorySourceRepository implements ISourceRepository {
  systems: any[] = [];
  snapshots: any[] = [];
  files: any[] = [];
  rows: any[] = [];

  async listSystems(tenantId: string) { return scoped(this.systems, tenantId); }

  async createSystem(input: any) {
    const system = {
      id: nextId('src'), connectionStatus: 'REGISTERED', configuredAt: new Date(),
      metadata: input.metadata ?? {}, ...input,
    };
    this.systems.push(system);
    return system;
  }

  async findSystem(tenantId: string, id: string) {
    return scoped(this.systems, tenantId).find((s) => s.id === id) ?? null;
  }

  async findSnapshotByRef(tenantId: string, snapshotRef: string) {
    return this.snapshots.find((s) => s.tenantId === tenantId && s.snapshotRef === snapshotRef) ?? null;
  }

  async createSnapshot(input: any) {
    // Mirrors the (tenant_id, snapshot_ref) unique index.
    const clash = this.snapshots.find((s) => s.tenantId === input.tenantId && s.snapshotRef === input.snapshotRef);
    if (clash) {
      const err: any = new Error('Unique constraint failed on the fields: (`tenant_id`,`snapshot_ref`)');
      err.code = 'P2002';
      throw err;
    }
    const snapshot = {
      id: nextId('snap'), status: 'REGISTERED', fileCount: 0, totalRows: 0, checksums: {}, ...input,
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  async listSnapshots(tenantId: string, sourceSystemId: string) {
    return scoped(this.snapshots, tenantId).filter((s) => s.sourceSystemId === sourceSystemId);
  }

  async findSnapshot(tenantId: string, snapshotId: string) {
    return scoped(this.snapshots, tenantId).find((s) => s.id === snapshotId) ?? null;
  }

  async findFileByChecksum(tenantId: string, checksum: string) {
    return scoped(this.files, tenantId).find((f) => f.checksumSha256 === checksum) ?? null;
  }

  async createFile(input: any) {
    // Same uniqueness the database enforces on (tenant_id, checksum_sha256).
    const clash = this.files.find((f) => f.tenantId === input.tenantId && f.checksumSha256 === input.checksumSha256);
    if (clash) {
      const err: any = new Error('Unique constraint failed on the fields: (`tenant_id`,`checksum_sha256`)');
      err.code = 'P2002';
      throw err;
    }
    const file = { id: nextId('file'), status: 'IMPORTED', importedAt: new Date(), ...input };
    this.files.push(file);
    return file;
  }

  async insertRows(input: any) {
    let inserted = 0;
    let skipped = 0;
    for (const row of input.rows) {
      // Same uniqueness the database enforces on (source_file_id, row_hash).
      const exists = this.rows.some((r) => r.sourceFileId === input.sourceFileId && r.rowHash === row.rowHash);
      if (exists) { skipped += 1; continue; }
      this.rows.push({
        id: nextId('row'), tenantId: input.tenantId, sourceFileId: input.sourceFileId,
        state: 'DISCOVERED', errorReason: null, ...row,
      });
      inserted += 1;
    }
    return { inserted, skippedDuplicates: skipped };
  }

  async listRows(tenantId: string, sourceFileId: string, limit: number, offset: number) {
    return scoped(this.rows, tenantId).filter((r) => r.sourceFileId === sourceFileId).slice(offset, offset + limit);
  }

  async listRowsBySnapshot(tenantId: string, snapshotId: string, limit?: number) {
    const fileIds = new Set(scoped(this.files, tenantId).filter((f) => f.snapshotId === snapshotId).map((f) => f.id));
    const rows = scoped(this.rows, tenantId).filter((r) => fileIds.has(r.sourceFileId));
    return limit ? rows.slice(0, limit) : rows;
  }

  async countRows(tenantId: string, sourceFileId: string) {
    return scoped(this.rows, tenantId).filter((r) => r.sourceFileId === sourceFileId).length;
  }

  async listFiles(tenantId: string, snapshotId: string) {
    return scoped(this.files, tenantId).filter((f) => f.snapshotId === snapshotId);
  }

  async updateSnapshotTotals(tenantId: string, snapshotId: string, fileCount: number, totalRows: number) {
    const snapshot = await this.findSnapshot(tenantId, snapshotId);
    if (snapshot) Object.assign(snapshot, { fileCount, totalRows });
  }
}

export class InMemoryMappingRepository implements IMappingRepository {
  sets: any[] = [];
  entries: any[] = [];

  async createSet(input: any) {
    const set = {
      id: nextId('mset'), status: 'DRAFT', frozenAt: null, frozenBy: null,
      approvedAt: null, approvedBy: null, usedByRunId: null, evidenceRefs: {}, ...input,
    };
    this.sets.push(set);
    return set;
  }

  async findSet(tenantId: string, id: string) {
    return scoped(this.sets, tenantId).find((s) => s.id === id) ?? null;
  }

  async listSets(tenantId: string, filters: any) {
    return scoped(this.sets, tenantId).filter((s) =>
      (!filters.legalEntityId || s.legalEntityId === filters.legalEntityId) &&
      (!filters.sourceSystemId || s.sourceSystemId === filters.sourceSystemId));
  }

  async nextVersion(tenantId: string, legalEntityId: string, sourceSystemId: string) {
    const versions = scoped(this.sets, tenantId)
      .filter((s) => s.legalEntityId === legalEntityId && s.sourceSystemId === sourceSystemId)
      .map((s) => s.version);
    return versions.length === 0 ? 1 : Math.max(...versions) + 1;
  }

  async upsertEntries(tenantId: string, mappingSetId: string, entries: any[]) {
    for (const entry of entries) {
      const existing = this.entries.find((e) =>
        e.mappingSetId === mappingSetId && e.sourceField === entry.sourceField && e.sourceValue === entry.sourceValue);
      if (existing) {
        Object.assign(existing, entry, {
          status: entry.classification ? 'MAPPED' : entry.status ?? existing.status,
          decidedAt: entry.classification ? new Date() : existing.decidedAt,
        });
      } else {
        this.entries.push({
          id: nextId('ment'), tenantId, mappingSetId,
          targetField: null, targetValue: null, classification: null, provenanceNote: null,
          decidedBy: null, decidedAt: null, approvedBy: null, approvedAt: null, evidenceRef: null,
          status: entry.classification ? 'MAPPED' : entry.status ?? 'MANUAL_REVIEW_REQUIRED',
          ...entry,
        });
      }
    }
    return entries.length;
  }

  async listEntries(tenantId: string, mappingSetId: string) {
    return scoped(this.entries, tenantId).filter((e) => e.mappingSetId === mappingSetId);
  }

  async findEntry(tenantId: string, entryId: string) {
    return scoped(this.entries, tenantId).find((e) => e.id === entryId) ?? null;
  }

  async updateEntry(tenantId: string, entryId: string, patch: Record<string, unknown>) {
    const entry = await this.findEntry(tenantId, entryId);
    if (!entry) throw new Error(`entry ${entryId} not found`);
    Object.assign(entry, patch);
    return entry;
  }

  async freezeSet(tenantId: string, id: string, frozenBy: string) {
    const set = await this.findSet(tenantId, id);
    if (!set) throw new Error(`mapping set ${id} not found`);
    Object.assign(set, { status: 'FROZEN', frozenAt: new Date(), frozenBy });
    return set;
  }

  async markUsed(tenantId: string, id: string, runId: string) {
    const set = await this.findSet(tenantId, id);
    if (set) Object.assign(set, { usedByRunId: runId });
    return set;
  }
}

export class InMemoryStagingRepository implements IStagingRepository {
  datasets: any[] = [];
  rows: any[] = [];

  async upsertDataset(input: any) {
    const existing = this.datasets.find((d) =>
      d.tenantId === input.tenantId && d.runId === input.runId && d.datasetType === input.datasetType);
    if (existing) {
      Object.assign(existing, { transformationVersion: input.transformationVersion, sourceRef: input.sourceRef });
      return existing;
    }
    const dataset = {
      id: nextId('ds'), state: 'DISCOVERED', rowCount: 0, acceptedCount: 0, rejectedCount: 0,
      skippedCount: 0, totalDebit: 0, totalCredit: 0, controlChecksum: null, ...input,
    };
    this.datasets.push(dataset);
    return dataset;
  }

  async findDataset(tenantId: string, runId: string, datasetType: string) {
    return scoped(this.datasets, tenantId).find((d) => d.runId === runId && d.datasetType === datasetType) ?? null;
  }

  async listDatasets(tenantId: string, runId: string) {
    return scoped(this.datasets, tenantId).filter((d) => d.runId === runId);
  }

  async insertRows(input: any) {
    let inserted = 0;
    let skipped = 0;
    for (const row of input.rows) {
      const exists = this.rows.some((r) => r.stagingDatasetId === input.stagingDatasetId && r.rowHash === row.rowHash);
      if (exists) { skipped += 1; continue; }
      this.rows.push({
        id: nextId('srow'), tenantId: input.tenantId, stagingDatasetId: input.stagingDatasetId,
        state: (row.validationErrors ?? []).length > 0 ? 'ERROR' : 'STAGED',
        promotedAt: null, promotedRecordId: null, ...row,
      });
      inserted += 1;
    }
    return { inserted, skippedDuplicates: skipped };
  }

  async listRows(tenantId: string, stagingDatasetId: string, limit = 100000, offset = 0) {
    return scoped(this.rows, tenantId).filter((r) => r.stagingDatasetId === stagingDatasetId).slice(offset, offset + limit);
  }

  async countRows(tenantId: string, stagingDatasetId: string) {
    return scoped(this.rows, tenantId).filter((r) => r.stagingDatasetId === stagingDatasetId).length;
  }

  async updateDataset(tenantId: string, datasetId: string, patch: Record<string, unknown>) {
    const dataset = scoped(this.datasets, tenantId).find((d) => d.id === datasetId);
    if (!dataset) throw new Error(`dataset ${datasetId} not found`);
    Object.assign(dataset, patch);
    return dataset;
  }

  async markRowsPromoted(tenantId: string, datasetId: string, promotions: { rowHash: string; promotedRecordId: string }[]) {
    let count = 0;
    for (const promotion of promotions) {
      const row = scoped(this.rows, tenantId)
        .find((r) => r.stagingDatasetId === datasetId && r.rowHash === promotion.rowHash && r.state !== 'PROMOTED');
      if (!row) continue;
      Object.assign(row, { state: 'PROMOTED', promotedAt: new Date(), promotedRecordId: promotion.promotedRecordId });
      count += 1;
    }
    return count;
  }

  async resetRows(tenantId: string, stagingDatasetId: string) {
    // Promoted rows are never reset — they are evidence of a financial effect
    // that must be undone by reversal, not by deletion.
    const rows = scoped(this.rows, tenantId)
      .filter((r) => r.stagingDatasetId === stagingDatasetId && r.state !== 'PROMOTED');
    for (const row of rows) Object.assign(row, { state: 'RESET' });
    return rows.length;
  }
}

export class InMemoryExceptionRepository implements IExceptionRepository {
  items: any[] = [];

  async create(input: any[]) {
    let inserted = 0;
    for (const item of input) {
      // Mirrors the real unique index on (run_id, dedupe_key).
      const dedupeKey = computeExceptionDedupeKey(item);
      if (this.items.some((e) => e.runId === item.runId && e.dedupeKey === dedupeKey)) continue;
      this.items.push({
        id: nextId('exc'), disposition: 'PENDING', dispositionedBy: null, dispositionedAt: null,
        dispositionReason: null, blocking: true, createdAt: new Date(), ...item, dedupeKey,
      });
      inserted += 1;
    }
    return inserted;
  }

  async list(tenantId: string, runId: string, filters: any = {}) {
    return scoped(this.items, tenantId).filter((e) =>
      e.runId === runId &&
      (!filters.disposition || e.disposition === filters.disposition) &&
      (!filters.exceptionType || e.exceptionType === filters.exceptionType));
  }

  async find(tenantId: string, id: string) {
    return scoped(this.items, tenantId).find((e) => e.id === id) ?? null;
  }

  async disposition(tenantId: string, id: string, patch: any) {
    const item = await this.find(tenantId, id);
    if (!item) throw new Error(`exception ${id} not found`);
    Object.assign(item, patch, { dispositionedAt: new Date() });
    return item;
  }

  async countBlockingPending(tenantId: string, runId: string) {
    return scoped(this.items, tenantId).filter((e) => e.runId === runId && e.blocking && e.disposition === 'PENDING').length;
  }
}

export class InMemoryGateRepository implements IGateRepository {
  results: any[] = [];

  async record(tenantId: string, runId: string, stagingDatasetId: string | null, evaluations: GateEvaluation[], evaluatedBy: string) {
    for (const evaluation of evaluations) {
      // Newest first, mirroring the Prisma repository's ordering contract.
      this.results.unshift({
        id: nextId('gate'), tenantId, runId, stagingDatasetId, evaluatedBy, evaluatedAt: new Date(),
        gateCode: evaluation.gateCode, result: evaluation.result, details: evaluation.details,
      });
    }
    return evaluations.length;
  }

  async list(tenantId: string, runId: string) {
    return scoped(this.results, tenantId).filter((g) => g.runId === runId);
  }
}

export class InMemoryControlTotalRepository implements IControlTotalRepository {
  totals: any[] = [];

  async capture(tenantId: string, runId: string, stagingDatasetId: string | null, snapshot: ControlTotalSnapshot) {
    const row = { id: nextId('ct'), tenantId, runId, stagingDatasetId, capturedAt: new Date(), ...snapshot };
    this.totals.push(row);
    return row;
  }

  async list(tenantId: string, runId: string) {
    return scoped(this.totals, tenantId).filter((t) => t.runId === runId);
  }
}

export class InMemoryLineageRepository implements ILineageRepository {
  entries: any[] = [];

  async record(entries: any[]) {
    let inserted = 0;
    for (const entry of entries) {
      const duplicate = entry.stagingRecordId && this.entries.some((e) =>
        e.tenantId === entry.tenantId && e.runId === entry.runId && e.stagingRecordId === entry.stagingRecordId);
      if (duplicate) continue;
      this.entries.push({
        id: nextId('lin'), createdAt: new Date(),
        sourceSystemRef: null, sourceFileRef: null, sourceRowRef: null, stagingRecordId: null,
        mappingDecisionRef: null, transformationVersion: null, targetRecordId: null, targetRecordType: null,
        postingExecutionRef: null, journalRef: null, openItemRef: null, reconciliationRef: null, evidence: {},
        ...entry,
      });
      inserted += 1;
    }
    return inserted;
  }

  async attach(entries: any[]) {
    let updated = 0;
    for (const entry of entries) {
      const existing = this.entries.find((e) =>
        e.tenantId === entry.tenantId && e.runId === entry.runId && e.stagingRecordId === entry.stagingRecordId);
      if (!existing) continue;
      for (const key of ['targetRecordId', 'targetRecordType', 'postingExecutionRef', 'journalRef', 'openItemRef', 'reconciliationRef']) {
        if (entry[key] !== undefined && entry[key] !== null) existing[key] = entry[key];
      }
      existing.evidence = { ...(existing.evidence ?? {}), ...(entry.evidence ?? {}) };
      updated += 1;
    }
    return updated;
  }

  async list(tenantId: string, runId: string, filters: any = {}) {
    return scoped(this.entries, tenantId).filter((l) =>
      l.runId === runId &&
      (!filters.sourceRowRef || l.sourceRowRef === filters.sourceRowRef) &&
      (!filters.journalRef || l.journalRef === filters.journalRef));
  }
}

export class InMemoryComparisonRepository implements IComparisonRepository {
  runs: any[] = [];
  diffs: any[] = [];

  async create(input: any) {
    const run = {
      id: nextId('cmp'), state: 'PENDING', signedOffBy: null, signedOffAt: null,
      signedOffEvidence: {}, totalDiffs: 0, unexplainedDiffs: 0, ...input,
    };
    this.runs.push(run);
    return run;
  }

  async nextVersion(tenantId: string, runId: string, periodYear: number, periodMonth: number) {
    const versions = scoped(this.runs, tenantId)
      .filter((r) => r.runId === runId && r.periodYear === periodYear && r.periodMonth === periodMonth)
      .map((r) => r.comparisonVersion);
    return versions.length === 0 ? 1 : Math.max(...versions) + 1;
  }

  async find(tenantId: string, id: string) {
    return scoped(this.runs, tenantId).find((r) => r.id === id) ?? null;
  }

  async list(tenantId: string, runId: string) {
    return scoped(this.runs, tenantId).filter((r) => r.runId === runId);
  }

  async insertDiffs(tenantId: string, comparisonRunId: string, diffs: any[]) {
    for (const diff of diffs) {
      this.diffs.push({
        id: nextId('diff'), tenantId, comparisonRunId, classifiedBy: null, classifiedAt: null,
        reason: null, disposition: 'PENDING', approvedBy: null, approvedAt: null, evidence: {}, ...diff,
      });
    }
    return diffs.length;
  }

  async listDiffs(tenantId: string, comparisonRunId: string) {
    return scoped(this.diffs, tenantId).filter((d) => d.comparisonRunId === comparisonRunId);
  }

  async findDiff(tenantId: string, diffId: string) {
    return scoped(this.diffs, tenantId).find((d) => d.id === diffId) ?? null;
  }

  async updateDiff(tenantId: string, diffId: string, patch: Record<string, unknown>) {
    const diff = await this.findDiff(tenantId, diffId);
    if (!diff) throw new Error(`diff ${diffId} not found`);
    Object.assign(diff, patch);
    return diff;
  }

  async updateRun(tenantId: string, id: string, patch: Record<string, unknown>) {
    const run = await this.find(tenantId, id);
    if (!run) throw new Error(`comparison ${id} not found`);
    Object.assign(run, patch);
    return run;
  }

  async countUnexplained(tenantId: string, runId: string) {
    const comparisons = await this.list(tenantId, runId);
    let count = 0;
    for (const comparison of comparisons) {
      for (const diff of await this.listDiffs(tenantId, comparison.id)) {
        const explained = diff.classification !== 'UNEXPLAINED' && diff.disposition === 'APPROVED' && !!diff.reason;
        if (!explained) count += 1;
      }
    }
    return count;
  }

  async allPeriodsSignedOff(tenantId: string, runId: string) {
    const comparisons = await this.list(tenantId, runId);
    if (comparisons.length === 0) return false;
    return comparisons.every((c) => c.state === 'SIGNED_OFF');
  }
}

export class InMemoryCutoverRepository implements ICutoverRepository {
  ceremonies: any[] = [];

  async upsert(input: any) {
    const existing = this.ceremonies.find((c) => c.tenantId === input.tenantId && c.runId === input.runId);
    if (existing) { Object.assign(existing, input); return { ...existing }; }
    const ceremony = {
      id: nextId('cer'), approverIdentity: null, approvedAt: null, approvalEvidence: {},
      executionStartedAt: null, executionCompletedAt: null, ...input,
    };
    this.ceremonies.push(ceremony);
    return { ...ceremony };
  }

  async find(tenantId: string, runId: string) {
    // A copy, like a real query result — callers must not hold a live handle
    // on stored state.
    const found = this.ceremonies.find((c) => c.tenantId === tenantId && c.runId === runId);
    return found ? { ...found } : null;
  }

  async update(tenantId: string, runId: string, patch: Record<string, unknown>) {
    const ceremony = this.ceremonies.find((c) => c.tenantId === tenantId && c.runId === runId);
    if (!ceremony) throw new Error(`ceremony for run ${runId} not found`);
    Object.assign(ceremony, patch);
    return { ...ceremony };
  }

  async claim(tenantId: string, runId: string, fromState: string, toState: string, patch: Record<string, unknown> = {}) {
    const ceremony = this.ceremonies.find((c) => c.tenantId === tenantId && c.runId === runId);
    if (!ceremony || ceremony.state !== fromState) return false;
    Object.assign(ceremony, patch, { state: toState });
    return true;
  }
}

export class InMemoryArchiveRepository implements IArchiveRepository {
  items: any[] = [];

  async create(input: any) {
    const item = { id: nextId('arc'), importedAt: new Date(), accessCount: 0, lastAccessedAt: null, ...input };
    this.items.push(item);
    return item;
  }

  async findByChecksum(tenantId: string, checksum: string) {
    return scoped(this.items, tenantId).find((i) => i.checksumSha256 === checksum) ?? null;
  }

  async list(tenantId: string, filters: any) {
    return scoped(this.items, tenantId).filter((i) =>
      (!filters.legalEntityId || i.legalEntityId === filters.legalEntityId) &&
      (!filters.periodYear || i.periodYear === filters.periodYear) &&
      (!filters.periodMonth || i.periodMonth === filters.periodMonth) &&
      (!filters.statementType || i.statementType === filters.statementType) &&
      (!filters.search || String(i.filename).toLowerCase().includes(String(filters.search).toLowerCase())));
  }

  async recordAccess(tenantId: string, id: string) {
    const item = scoped(this.items, tenantId).find((i) => i.id === id);
    if (!item) throw new Error(`archive artifact ${id} not found`);
    item.accessCount += 1;
    item.lastAccessedAt = new Date();
    return item;
  }
}

export class InMemoryRunbookRepository implements IRunbookRepository {
  templates: any[] = [];
  instances: any[] = [];

  async listTemplates(tenantId: string) { return scoped(this.templates, tenantId); }

  async createTemplate(input: any) {
    const template = { id: nextId('rbt'), ...input };
    this.templates.push(template);
    return template;
  }

  async findTemplate(tenantId: string, id: string) {
    return scoped(this.templates, tenantId).find((t) => t.id === id) ?? null;
  }

  async listInstances(tenantId: string, runId?: string) {
    return scoped(this.instances, tenantId).filter((i) => !runId || i.runId === runId);
  }

  async createInstance(input: any) {
    const instance = { id: nextId('rbi'), state: 'ACTIVE', ...input };
    this.instances.push(instance);
    return instance;
  }

  async findInstance(tenantId: string, id: string) {
    return scoped(this.instances, tenantId).find((i) => i.id === id) ?? null;
  }

  async updateInstance(tenantId: string, id: string, patch: Record<string, unknown>) {
    const instance = await this.findInstance(tenantId, id);
    if (!instance) throw new Error(`runbook instance ${id} not found`);
    Object.assign(instance, patch);
    return instance;
  }
}

/**
 * Records every governed posting request and honours the idempotency identity:
 * the same identity always resolves to the same journal, never a second one.
 */
export class FakePostingClient implements IPostingClient {
  requests: GovernedPostingRequest[] = [];
  byIdentity = new Map<string, GovernedPostingResult>();
  mode: 'POSTED' | 'PENDING' | 'REJECTED' = 'POSTED';

  async post(request: GovernedPostingRequest): Promise<GovernedPostingResult> {
    this.requests.push(request);
    const existing = this.byIdentity.get(request.idempotencyIdentity);
    if (existing) return existing;

    let result: GovernedPostingResult;
    if (this.mode === 'PENDING') {
      result = { status: PENDING_UPSTREAM, postingExecutionRef: null, journalRef: null, reason: 'posting engine not reconciled' };
    } else if (this.mode === 'REJECTED') {
      result = { status: 'REJECTED', postingExecutionRef: null, journalRef: null, reason: 'rejected by posting engine' };
    } else {
      const journalRef = nextId('JRN');
      result = { status: 'POSTED', postingExecutionRef: nextId('PEX'), journalRef };
      this.byIdentity.set(request.idempotencyIdentity, result);
    }
    return result;
  }

  /** Distinct idempotency identities the posting engine has been asked to honour. */
  seenIdentities(): string[] {
    return [...new Set(this.requests.map((r) => r.idempotencyIdentity))];
  }
}

export class FakeScheduleClient implements IScheduleClient {
  requests: OpenItemEstablishRequest[] = [];
  byIdentity = new Map<string, string>();
  mode: 'ESTABLISHED' | 'PENDING' | 'REJECTED' = 'ESTABLISHED';

  async establishOpenItems(request: OpenItemEstablishRequest): Promise<OpenItemEstablishResult> {
    this.requests.push(request);
    if (this.mode === 'PENDING') {
      return { status: PENDING_UPSTREAM, establishedRefs: [], reason: 'schedule contract not reconciled' };
    }
    if (this.mode === 'REJECTED') {
      return { status: 'REJECTED', establishedRefs: [], reason: 'rejected by schedule service' };
    }
    const establishedRefs = request.items.map((item) => {
      const key = `${request.runId}:${item.sourceIdentity}`;
      const ref = this.byIdentity.get(key) ?? nextId('OI');
      this.byIdentity.set(key, ref);
      return { sourceIdentity: item.sourceIdentity, openItemRef: ref };
    });
    return { status: 'ESTABLISHED', establishedRefs };
  }
}

export class FakeCloseReadiness implements ICloseReadinessProvider {
  approved = true;
  closeState = 'PRELIMINARY_CLOSED';
  private _evidence: Ce15ReadinessEvidence[] = [];

  async getReadiness(): Promise<Ce15ReadinessEvidence> {
    return this.approved
      ? {
          status: 'AVAILABLE' as const,
          approved: true,
          detail: `CE-15 close approved: ${this.closeState}`,
          closeState: this.closeState,
          previousState: null,
          closeVersion: 1,
          transitionBy: 'controller@test',
          transitionAt: new Date(),
          allTasksVerified: true,
          hasUnreconciled: false,
          hasOpenExceptions: false,
          preliminaryClosed: true,
          finallyClosed: false,
          reopenPending: false,
          upstreamSignals: [],
          rawStatePayload: { state: this.closeState },
          rawReadinessPayload: {},
          certificationIdentity: 'controller@test',
          evidenceRef: 'evidence-001',
          capturedAt: new Date(),
        }
      : {
          status: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' as const,
          approved: false,
          detail: 'CE-15 readiness not approved',
          capturedAt: new Date(),
        };
  }

  async persistEvidence(_tenantId: string, _runId: string, evidence: Ce15ReadinessEvidence): Promise<void> {
    this._evidence.push(evidence);
  }

  async getLatestEvidence(_tenantId: string, _runId: string): Promise<Ce15ReadinessEvidence | null> {
    return this._evidence[this._evidence.length - 1] ?? null;
  }
}

export class FakeConsolidationHistory implements IConsolidationHistoryProvider {
  async getHistory() {
    return { status: PENDING_UPSTREAM, periods: [], detail: 'CE-06 consolidation history not technically reconciled' };
  }
}

export class FakeUpstreamTargets implements IUpstreamTargetClient {
  async getSignal(moduleCode: string) {
    return { moduleCode: moduleCode as any, status: PENDING_UPSTREAM, detail: `${moduleCode} migration target not reconciled` };
  }
  async getAllSignals() {
    return ['CE-09', 'CE-11', 'CE-12', 'CE-13', 'CE-14'].map((m) => ({
      moduleCode: m as any, status: PENDING_UPSTREAM, detail: `${m} migration target not reconciled`,
    }));
  }
  async migrateInto(moduleCode: string) {
    return { status: PENDING_UPSTREAM, targetRecordIds: [], detail: `${moduleCode} migration target not reconciled` };
  }
}

export class RecordingEventPublisher implements IEventPublisherPort {
  events: { type: string; tenantId: string; payload: Record<string, unknown> }[] = [];
  async publishMigrationEvent(type: string, tenantId: string, payload: Record<string, unknown>) {
    this.events.push({ type, tenantId, payload });
  }
  types() { return this.events.map((e) => e.type); }
}

export interface TestHarness {
  runs: InMemoryRunRepository;
  sources: InMemorySourceRepository;
  mappings: InMemoryMappingRepository;
  staging: InMemoryStagingRepository;
  exceptions: InMemoryExceptionRepository;
  gates: InMemoryGateRepository;
  controlTotals: InMemoryControlTotalRepository;
  lineage: InMemoryLineageRepository;
  comparisons: InMemoryComparisonRepository;
  cutovers: InMemoryCutoverRepository;
  archive: InMemoryArchiveRepository;
  runbooks: InMemoryRunbookRepository;
  posting: FakePostingClient;
  schedules: FakeScheduleClient;
  closeReadiness: FakeCloseReadiness;
  consolidation: FakeConsolidationHistory;
  upstream: FakeUpstreamTargets;
  events: RecordingEventPublisher;
}

export function makeHarness(): TestHarness {
  return {
    runs: new InMemoryRunRepository(),
    sources: new InMemorySourceRepository(),
    mappings: new InMemoryMappingRepository(),
    staging: new InMemoryStagingRepository(),
    exceptions: new InMemoryExceptionRepository(),
    gates: new InMemoryGateRepository(),
    controlTotals: new InMemoryControlTotalRepository(),
    lineage: new InMemoryLineageRepository(),
    comparisons: new InMemoryComparisonRepository(),
    cutovers: new InMemoryCutoverRepository(),
    archive: new InMemoryArchiveRepository(),
    runbooks: new InMemoryRunbookRepository(),
    posting: new FakePostingClient(),
    schedules: new FakeScheduleClient(),
    closeReadiness: new FakeCloseReadiness(),
    consolidation: new FakeConsolidationHistory(),
    upstream: new FakeUpstreamTargets(),
    events: new RecordingEventPublisher(),
  };
}

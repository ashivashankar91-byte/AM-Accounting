/**
 * CE-16 — Domain ports.
 *
 * Repositories and upstream clients are declared here so the application layer
 * never imports Prisma or fetch directly, and so the CE-09/CE-11/CE-12/CE-13/
 * CE-14/CE-15/CE-06 adapters that are not yet technically reconciled can be
 * satisfied by a truthful "unavailable" implementation without any call site
 * pretending a record was migrated.
 */

import { GateEvaluation } from './gate-evaluator';
import { ControlTotalSnapshot } from './control-total-calculator';
import { MigrationState } from './migration-state-machine';

export const PENDING_UPSTREAM = 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' as const;

export type UpstreamStatus = 'AVAILABLE' | 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' | 'NOT_CONFIGURED';

// ── Migration runs ───────────────────────────────────────────────────────────

export interface MigrationRunRecord {
  id: string;
  tenantId: string;
  legalEntityId: string;
  runId: string;
  mode: string;
  state: string;
  sourceSnapshotRef: string | null;
  transformationVersion: string;
  frozenAt: Date | null;
  freezeAttestedBy: string | null;
  preparedBy: string | null;
  approvedBy: string | null;
  approvalAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  rolledBackAt: Date | null;
  metadata: unknown;
}

export interface IMigrationRunRepository {
  create(input: {
    tenantId: string;
    legalEntityId: string;
    runId: string;
    mode: string;
    transformationVersion: string;
    sourceSnapshotRef?: string | null;
    createdBy: string;
    metadata?: Record<string, unknown>;
  }): Promise<MigrationRunRecord>;
  findByRunId(tenantId: string, runId: string): Promise<MigrationRunRecord | null>;
  list(tenantId: string, filters: { legalEntityId?: string; state?: string; mode?: string }): Promise<MigrationRunRecord[]>;
  updateState(tenantId: string, runId: string, state: MigrationState, patch?: Record<string, unknown>): Promise<MigrationRunRecord>;
  patch(tenantId: string, runId: string, patch: Record<string, unknown>): Promise<MigrationRunRecord>;
  appendAudit(input: {
    tenantId: string;
    runId: string;
    action: string;
    actor: string;
    fromState?: string | null;
    toState?: string | null;
    reason?: string | null;
    evidence?: Record<string, unknown>;
  }): Promise<void>;
  listAudit(tenantId: string, runId: string): Promise<unknown[]>;
}

// ── Source inventory ─────────────────────────────────────────────────────────

export interface ISourceRepository {
  listSystems(tenantId: string): Promise<any[]>;
  createSystem(input: {
    tenantId: string; systemCode: string; systemName: string; sourceType: string; configuredBy: string;
    connectionStatus?: string; metadata?: Record<string, unknown>;
  }): Promise<any>;
  findSystem(tenantId: string, id: string): Promise<any | null>;
  findSnapshotByRef(tenantId: string, snapshotRef: string): Promise<any | null>;
  createSnapshot(input: {
    tenantId: string; legalEntityId: string; sourceSystemId: string; snapshotRef: string; extractedAt: Date;
    importedBy: string; isDelta?: boolean; baseSnapshotId?: string | null; checksums?: Record<string, unknown>;
  }): Promise<any>;
  listSnapshots(tenantId: string, sourceSystemId: string): Promise<any[]>;
  findSnapshot(tenantId: string, snapshotId: string): Promise<any | null>;
  findFileByChecksum(tenantId: string, checksum: string): Promise<any | null>;
  createFile(input: {
    tenantId: string; snapshotId: string; filename: string; filePath: string; fileSize: number;
    checksumSha256: string; rowCount: number;
  }): Promise<any>;
  insertRows(input: {
    tenantId: string; sourceFileId: string;
    rows: { rowIndex: number; rowHash: string; rawData: Record<string, unknown> }[];
  }): Promise<{ inserted: number; skippedDuplicates: number }>;
  listRows(tenantId: string, sourceFileId: string, limit: number, offset: number): Promise<any[]>;
  listRowsBySnapshot(tenantId: string, snapshotId: string, limit?: number): Promise<any[]>;
  countRows(tenantId: string, sourceFileId: string): Promise<number>;
  listFiles(tenantId: string, snapshotId: string): Promise<any[]>;
  updateSnapshotTotals(tenantId: string, snapshotId: string, fileCount: number, totalRows: number): Promise<void>;
}

// ── Mapping workbench ────────────────────────────────────────────────────────

export interface IMappingRepository {
  createSet(input: {
    tenantId: string; legalEntityId: string; sourceSystemId: string; version: number; createdBy: string;
  }): Promise<any>;
  findSet(tenantId: string, id: string): Promise<any | null>;
  listSets(tenantId: string, filters: { legalEntityId?: string; sourceSystemId?: string }): Promise<any[]>;
  nextVersion(tenantId: string, legalEntityId: string, sourceSystemId: string): Promise<number>;
  upsertEntries(tenantId: string, mappingSetId: string, entries: {
    sourceField: string; sourceValue: string; targetField?: string | null; targetValue?: string | null;
    classification?: string | null; provenanceNote?: string | null; status?: string; decidedBy?: string | null;
  }[]): Promise<number>;
  listEntries(tenantId: string, mappingSetId: string): Promise<any[]>;
  findEntry(tenantId: string, entryId: string): Promise<any | null>;
  updateEntry(tenantId: string, entryId: string, patch: Record<string, unknown>): Promise<any>;
  freezeSet(tenantId: string, id: string, frozenBy: string): Promise<any>;
  markUsed(tenantId: string, id: string, runId: string): Promise<any>;
}

// ── Staging ──────────────────────────────────────────────────────────────────

export interface IStagingRepository {
  upsertDataset(input: {
    tenantId: string; legalEntityId: string; runId: string; datasetType: string; transformationVersion: string;
    mappingSetId?: string | null; sourceRef?: string | null;
  }): Promise<any>;
  findDataset(tenantId: string, runId: string, datasetType: string): Promise<any | null>;
  listDatasets(tenantId: string, runId: string): Promise<any[]>;
  insertRows(input: {
    tenantId: string; stagingDatasetId: string;
    rows: {
      sourceRowId: string | null; rowHash: string; stagedData: Record<string, unknown>;
      validationErrors: unknown[]; lineageRef: Record<string, unknown>;
    }[];
  }): Promise<{ inserted: number; skippedDuplicates: number }>;
  listRows(tenantId: string, stagingDatasetId: string, limit?: number, offset?: number): Promise<any[]>;
  countRows(tenantId: string, stagingDatasetId: string): Promise<number>;
  updateDataset(tenantId: string, datasetId: string, patch: Record<string, unknown>): Promise<any>;
  markRowsPromoted(tenantId: string, datasetId: string, promotions: { rowHash: string; promotedRecordId: string }[]): Promise<number>;
  resetRows(tenantId: string, stagingDatasetId: string): Promise<number>;
}

// ── Exceptions, gates, control totals, lineage ───────────────────────────────

export interface IExceptionRepository {
  create(input: {
    tenantId: string; legalEntityId: string; runId: string; exceptionType: string; reason: string;
    sourceRowId?: string | null; stagingRowId?: string | null; sourceField?: string | null;
    sourceValue?: string | null; blocking?: boolean; evidence?: Record<string, unknown>;
  }[]): Promise<number>;
  list(tenantId: string, runId: string, filters?: { disposition?: string; exceptionType?: string }): Promise<any[]>;
  find(tenantId: string, id: string): Promise<any | null>;
  disposition(tenantId: string, id: string, patch: {
    disposition: string; dispositionedBy: string; dispositionReason: string;
  }): Promise<any>;
  countBlockingPending(tenantId: string, runId: string): Promise<number>;
}

export interface IGateRepository {
  record(tenantId: string, runId: string, stagingDatasetId: string | null, evaluations: GateEvaluation[], evaluatedBy: string): Promise<number>;
  list(tenantId: string, runId: string): Promise<any[]>;
}

export interface IControlTotalRepository {
  capture(tenantId: string, runId: string, stagingDatasetId: string | null, snapshot: ControlTotalSnapshot): Promise<any>;
  list(tenantId: string, runId: string): Promise<any[]>;
}

export interface ILineageRepository {
  record(entries: {
    tenantId: string; runId: string; sourceSystemRef?: string | null; sourceFileRef?: string | null;
    sourceRowRef?: string | null; stagingRecordId?: string | null; mappingDecisionRef?: string | null;
    transformationVersion?: string | null; targetRecordId?: string | null; targetRecordType?: string | null;
    postingExecutionRef?: string | null; journalRef?: string | null; openItemRef?: string | null;
    reconciliationRef?: string | null; evidence?: Record<string, unknown>;
  }[]): Promise<number>;
  /**
   * Extends the lineage row already recorded for a staged record with its
   * target-side references. Promotion never inserts a second lineage row for a
   * record that already has one — a record has exactly one path through the
   * migration, and that path is completed, not duplicated.
   */
  attach(entries: {
    tenantId: string; runId: string; stagingRecordId: string; targetRecordId?: string | null;
    targetRecordType?: string | null; postingExecutionRef?: string | null; journalRef?: string | null;
    openItemRef?: string | null; reconciliationRef?: string | null; evidence?: Record<string, unknown>;
  }[]): Promise<number>;
  list(tenantId: string, runId: string, filters?: { sourceRowRef?: string; journalRef?: string }): Promise<any[]>;
}

// ── Comparison harness ───────────────────────────────────────────────────────

export interface IComparisonRepository {
  create(input: {
    tenantId: string; legalEntityId: string; runId: string; periodYear: number; periodMonth: number;
    legacySnapshotRef?: string | null; operatorId: string; comparisonVersion: number;
  }): Promise<any>;
  nextVersion(tenantId: string, runId: string, periodYear: number, periodMonth: number): Promise<number>;
  find(tenantId: string, id: string): Promise<any | null>;
  list(tenantId: string, runId: string): Promise<any[]>;
  insertDiffs(tenantId: string, comparisonRunId: string, diffs: {
    diffType: string; dimension: string; sourceValue: number; targetValue: number; variance: number;
    classification: string;
  }[]): Promise<number>;
  listDiffs(tenantId: string, comparisonRunId: string): Promise<any[]>;
  findDiff(tenantId: string, diffId: string): Promise<any | null>;
  updateDiff(tenantId: string, diffId: string, patch: Record<string, unknown>): Promise<any>;
  updateRun(tenantId: string, id: string, patch: Record<string, unknown>): Promise<any>;
  countUnexplained(tenantId: string, runId: string): Promise<number>;
  allPeriodsSignedOff(tenantId: string, runId: string): Promise<boolean>;
}

// ── Cutover, archive, runbooks ───────────────────────────────────────────────

export interface ICutoverRepository {
  upsert(input: Record<string, unknown>): Promise<any>;
  find(tenantId: string, runId: string): Promise<any | null>;
  update(tenantId: string, runId: string, patch: Record<string, unknown>): Promise<any>;
  /**
   * Atomic compare-and-set on the ceremony state. Returns true only for the
   * caller that won the transition, so two operators pressing execute at the
   * same moment cannot both run the irreversible path.
   */
  claim(tenantId: string, runId: string, fromState: string, toState: string, patch?: Record<string, unknown>): Promise<boolean>;
}

export interface IArchiveRepository {
  create(input: {
    tenantId: string; legalEntityId: string; periodYear: number; periodMonth: number; statementType: string;
    sourceSystem: string; filename: string; fileSize: number; checksumSha256: string; importedBy: string;
    wormClass: string; retentionUntil: Date | null; metadata?: Record<string, unknown>;
  }): Promise<any>;
  findByChecksum(tenantId: string, checksum: string): Promise<any | null>;
  list(tenantId: string, filters: {
    legalEntityId?: string; periodYear?: number; periodMonth?: number; statementType?: string; search?: string;
  }): Promise<any[]>;
  recordAccess(tenantId: string, id: string): Promise<any>;
}

export interface IRunbookRepository {
  listTemplates(tenantId: string): Promise<any[]>;
  createTemplate(input: { tenantId: string; name: string; version: number; steps: unknown; createdBy: string }): Promise<any>;
  findTemplate(tenantId: string, id: string): Promise<any | null>;
  listInstances(tenantId: string, runId?: string): Promise<any[]>;
  createInstance(input: {
    tenantId: string; legalEntityId: string; templateId: string; runId: string; steps: unknown; createdBy: string;
  }): Promise<any>;
  findInstance(tenantId: string, id: string): Promise<any | null>;
  updateInstance(tenantId: string, id: string, patch: Record<string, unknown>): Promise<any>;
}

// ── Upstream ports ───────────────────────────────────────────────────────────

/**
 * CE-07 governed posting. Financial promotion never writes GL directly: it
 * hands a conversion transaction to the posting engine and records the
 * returned posting execution + journal references as lineage.
 */
export interface GovernedPostingRequest {
  tenantId: string;
  legalEntityId: string;
  runId: string;
  /** Deterministic; a retried promotion must resolve to the same identity. */
  idempotencyIdentity: string;
  businessDate: string;
  journalFamily: 'CONVERSION' | 'CONVERSION_REVERSAL';
  memo: string;
  lines: { accountCode: string; debit: number; credit: number; description?: string; sourceRowRef?: string }[];
  originalJournalRef?: string | null;
}

export interface GovernedPostingResult {
  status: 'POSTED' | 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' | 'REJECTED';
  postingExecutionRef: string | null;
  journalRef: string | null;
  reason?: string;
}

export interface IPostingClient {
  post(request: GovernedPostingRequest): Promise<GovernedPostingResult>;
}

/** CE-08 schedule / open-item establishment through the governed contract. */
export interface OpenItemEstablishRequest {
  tenantId: string;
  legalEntityId: string;
  runId: string;
  controlAccount: string;
  items: {
    sourceIdentity: string; documentRef: string; documentDate: string; dueDate?: string | null;
    amount: number; partyRef?: string | null; agingBucket?: string | null;
    /** Migration principle 7 — the target must be able to name its source. */
    sourceRowRef: string;
    stagingRecordId: string;
  }[];
}

export interface OpenItemEstablishResult {
  status: 'ESTABLISHED' | 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' | 'REJECTED';
  establishedRefs: { sourceIdentity: string; openItemRef: string }[];
  reason?: string;
}

export interface IScheduleClient {
  establishOpenItems(request: OpenItemEstablishRequest): Promise<OpenItemEstablishResult>;
}

/** CE-15 close readiness provider — final approval gate for cutover. */
/** Full CE-15 readiness evidence returned by the real close-service contract. */
export interface Ce15ReadinessEvidence {
  status: UpstreamStatus;
  approved: boolean;
  detail: string;
  // Rich evidence fields — populated when status === 'AVAILABLE'
  closeState?: string;
  previousState?: string | null;
  closeVersion?: number | null;
  transitionBy?: string | null;
  transitionAt?: Date | null;
  allTasksVerified?: boolean;
  hasUnreconciled?: boolean;
  hasOpenExceptions?: boolean;
  preliminaryClosed?: boolean;
  finallyClosed?: boolean;
  reopenPending?: boolean;
  upstreamSignals?: unknown[];
  rawStatePayload?: Record<string, unknown>;
  rawReadinessPayload?: Record<string, unknown>;
  certificationIdentity?: string | null;
  evidenceRef?: string | null;
  capturedAt?: Date;
}

export interface ICloseReadinessProvider {
  /** Fetch real CE-15 readiness from the close-service. Fail-closed on unavailability. */
  getReadiness(
    tenantId: string,
    legalEntityId: string,
    periodYear: number,
    periodMonth: number,
    actor?: string,
  ): Promise<Ce15ReadinessEvidence>;
  /** Persist the captured evidence row (immutable, append-only). */
  persistEvidence(tenantId: string, runId: string, evidence: Ce15ReadinessEvidence): Promise<void>;
  /** Return the most recent persisted evidence for staleness checks. */
  getLatestEvidence(tenantId: string, runId: string): Promise<Ce15ReadinessEvidence | null>;
}

/** CE-06 consolidation history provider — comparative history for conversion. */
export interface IConsolidationHistoryProvider {
  getHistory(tenantId: string, legalEntityId: string, periodYear: number): Promise<{
    status: UpstreamStatus;
    periods: { periodYear: number; periodMonth: number; available: boolean }[];
    detail: string;
  }>;
}

/** Not-yet-reconciled domain migration targets (CE-09/11/12/13/14). */
export type UpstreamTargetModule = 'CE-09' | 'CE-11' | 'CE-12' | 'CE-13' | 'CE-14';

export interface UpstreamTargetSignal {
  moduleCode: UpstreamTargetModule | 'CE-06' | 'CE-15';
  status: UpstreamStatus;
  detail: string;
}

export interface IUpstreamTargetClient {
  getSignal(moduleCode: string): Promise<UpstreamTargetSignal>;
  getAllSignals(): Promise<UpstreamTargetSignal[]>;
  /**
   * Attempts to migrate records into an upstream domain target. Returns a
   * truthful PENDING_UPSTREAM_TECHNICAL_RECONCILIATION result when the target
   * API is not yet reconciled — never a fabricated target id, never a
   * "migrated" marker.
   */
  migrateInto(moduleCode: string, payload: Record<string, unknown>): Promise<{
    status: UpstreamStatus;
    targetRecordIds: string[];
    detail: string;
  }>;
}

export interface IEventPublisherPort {
  publishMigrationEvent(type: string, tenantId: string, payload: Record<string, unknown>): Promise<void>;
}

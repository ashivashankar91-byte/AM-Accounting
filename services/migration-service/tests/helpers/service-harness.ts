/**
 * Wires the in-memory harness into the real application services, so an
 * integration test drives the same code paths the HTTP layer drives.
 */

import { makeHarness, TestHarness } from './in-memory-repos';
import { PASSTHROUGH_FIELDS } from '../../src/domain/transformation-engine';
import { MigrationRunService } from '../../src/application/migration-run-service';
import { SourceService } from '../../src/application/source-service';
import { MappingService } from '../../src/application/mapping-service';
import { StagingService } from '../../src/application/staging-service';
import { PromotionService } from '../../src/application/promotion-service';
import { ExceptionService } from '../../src/application/exception-service';
import { ComparisonService } from '../../src/application/comparison-service';
import { CutoverService } from '../../src/application/cutover-service';
import { ArchiveService } from '../../src/application/archive-service';
import { RunbookService } from '../../src/application/runbook-service';

export const TENANT = 'tenant-cert-a';
export const OTHER_TENANT = 'tenant-cert-b';
export const LE = 'LE-CERT-001';
export const OTHER_LE = 'LE-CERT-002';

export const OPERATOR = 'user-operator';
export const APPROVER = 'user-approver';
export const CONTROLLER = 'user-controller';

export interface Services {
  h: TestHarness;
  runService: MigrationRunService;
  sourceService: SourceService;
  mappingService: MappingService;
  stagingService: StagingService;
  promotionService: PromotionService;
  exceptionService: ExceptionService;
  comparisonService: ComparisonService;
  cutoverService: CutoverService;
  archiveService: ArchiveService;
  runbookService: RunbookService;
}

export function makeServices(h: TestHarness = makeHarness()): Services {
  const runService = new MigrationRunService(
    h.runs, h.exceptions, h.gates, h.comparisons, h.cutovers, h.closeReadiness, h.events,
  );
  const sourceService = new SourceService(h.sources, h.upstream);
  const mappingService = new MappingService(h.mappings, h.sources);
  const stagingService = new StagingService(
    h.staging, h.sources, h.exceptions, h.gates, h.controlTotals, h.lineage, h.runs, h.events, mappingService,
  );
  const promotionService = new PromotionService(
    h.staging, h.lineage, h.runs, h.exceptions, h.controlTotals, h.posting, h.schedules, h.upstream,
  );
  const exceptionService = new ExceptionService(h.exceptions, h.runs);
  const comparisonService = new ComparisonService(h.comparisons, h.staging, h.runs, h.consolidation);
  const cutoverService = new CutoverService(
    h.cutovers, h.runs, h.staging, h.posting, h.lineage, h.events, runService, promotionService,
  );
  const archiveService = new ArchiveService(h.archive);
  const runbookService = new RunbookService(h.runbooks, h.gates, h.runs, h.comparisons);

  return {
    h, runService, sourceService, mappingService, stagingService, promotionService,
    exceptionService, comparisonService, cutoverService, archiveService, runbookService,
  };
}

/**
 * Every field in the batch that carries accounting meaning and therefore needs
 * an explicit mapping decision. Passthrough fields are identity, not meaning.
 */
export function mappableFields(rows: Record<string, unknown>[]): string[] {
  const fields = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!PASSTHROUGH_FIELDS.has(key)) fields.add(key);
    }
  }
  return [...fields].sort();
}

/** Balanced synthetic TB rows — CERTIFICATION-ONLY synthetic data. */
export const BALANCED_TB_ROWS = [
  { accountCode: '1000', accountName: 'Cash In Bank', debit: 125000.0, credit: 0, description: 'Opening cash' },
  { accountCode: '1200', accountName: 'Accounts Receivable', debit: 48250.75, credit: 0, description: 'Opening AR' },
  { accountCode: '2000', accountName: 'Accounts Payable', debit: 0, credit: 61300.25, description: 'Opening AP' },
  { accountCode: '3000', accountName: 'Owners Equity', debit: 0, credit: 111950.5, description: 'Opening equity' },
];

export const UNBALANCED_TB_ROWS = [
  { accountCode: '1000', accountName: 'Cash In Bank', debit: 10000.0, credit: 0, description: 'Cash' },
  { accountCode: '2000', accountName: 'Accounts Payable', debit: 0, credit: 9999.99, description: 'AP one cent short' },
];

export const OPEN_ITEM_ROWS = [
  { controlAccount: '1200', sourceIdentity: 'AR-INV-8801', documentRef: 'INV-8801', documentDate: '2025-10-02', dueDate: '2025-11-01', openItemAmount: 18000.0, partyRef: 'CUST-001' },
  { controlAccount: '1200', sourceIdentity: 'AR-INV-8802', documentRef: 'INV-8802', documentDate: '2025-10-18', dueDate: '2025-11-17', openItemAmount: 21250.75, partyRef: 'CUST-002' },
  { controlAccount: '1200', sourceIdentity: 'AR-INV-8803', documentRef: 'INV-8803', documentDate: '2025-11-20', dueDate: '2025-12-20', openItemAmount: 9000.0, partyRef: 'CUST-003' },
];

/**
 * Registers a source system, snapshot and file, then seeds and freezes a
 * mapping set covering every account value in the rows. Returns the ids a
 * staging call needs.
 */
export async function setupSource(
  s: Services,
  rows: Record<string, unknown>[],
  options: { tenantId?: string; legalEntityId?: string; mappingFields?: string[] } = {},
) {
  const tenantId = options.tenantId ?? TENANT;
  const legalEntityId = options.legalEntityId ?? LE;
  const fields = options.mappingFields ?? mappableFields(rows);

  const system = await s.sourceService.registerSystem({
    tenantId, systemCode: `LEGACY-${legalEntityId}`, systemName: 'Synthetic legacy (certification)',
    sourceType: 'AUTOMATE', actor: OPERATOR,
  });
  const snapshot = await s.sourceService.registerSnapshot({
    tenantId, legalEntityId, sourceSystemId: system.id, snapshotRef: `SNAP-${Date.now()}-${Math.random()}`,
    extractedAt: new Date().toISOString(), actor: OPERATOR,
  });
  const imported = await s.sourceService.importRows({
    tenantId, legalEntityId, snapshotId: snapshot.id, filename: 'tb.csv', filePath: '/certification/tb.csv',
    declaredChecksum: '', rows, actor: OPERATOR,
  });

  const mappingSet = await s.mappingService.createSet({
    tenantId, legalEntityId, sourceSystemId: system.id, actor: OPERATOR,
  });
  await s.mappingService.seedFromSnapshot({
    tenantId, mappingSetId: mappingSet.id, snapshotId: snapshot.id, fields,
  });

  return { system, snapshot, imported, mappingSet, tenantId, legalEntityId, fields };
}

/** Classifies every seeded entry as ALIGN and freezes the set. */
export async function decideAndFreeze(
  s: Services,
  tenantId: string,
  mappingSetId: string,
  options: { skipFreeze?: boolean } = {},
) {
  const { items } = await s.mappingService.listEntries(tenantId, mappingSetId);
  await s.mappingService.upsertEntries({
    tenantId, mappingSetId, actor: OPERATOR,
    entries: (items as any[]).map((e) => ({
      sourceField: e.sourceField,
      sourceValue: e.sourceValue,
      targetField: e.sourceField,
      targetValue: e.sourceValue,
      classification: 'ALIGN',
      provenanceNote: 'Chart position identical in modern COA',
    })),
  });
  if (options.skipFreeze) return null;
  return s.mappingService.freeze({ tenantId, mappingSetId, actor: CONTROLLER });
}

/** Full happy path from raw rows to a staged, validated dataset. */
export async function stageAndValidate(
  s: Services,
  rows: Record<string, unknown>[],
  datasetType = 'TB',
  options: { tenantId?: string; legalEntityId?: string; runId?: string; mappingFields?: string[] } = {},
) {
  const setup = await setupSource(s, rows, options);
  await decideAndFreeze(s, setup.tenantId, setup.mappingSet.id);

  const run = await s.runService.create({
    tenantId: setup.tenantId, legalEntityId: setup.legalEntityId, mode: 'REHEARSAL',
    transformationVersion: 'ce16.v1', actor: OPERATOR, runId: options.runId,
  });
  const staged = await s.stagingService.stage({
    tenantId: setup.tenantId, legalEntityId: setup.legalEntityId, runId: run.runId,
    snapshotId: setup.snapshot.id, mappingSetId: setup.mappingSet.id, datasetType, actor: OPERATOR,
  });
  const validated = await s.stagingService.validate({
    tenantId: setup.tenantId, runId: run.runId, actor: OPERATOR, agingAsOf: '2025-12-31',
  });
  return { ...setup, run, staged, validated };
}

/**
 * Drives a run all the way to READY_FOR_CUTOVER, satisfying every prerequisite
 * with real evidence rather than by patching state.
 */
export async function driveToReadyForCutover(s: Services, options: { runId?: string } = {}) {
  const ctx = await stageAndValidate(s, BALANCED_TB_ROWS, 'TB', options);
  const { tenantId, legalEntityId, run } = ctx;

  await s.runService.attestFreeze(tenantId, run.runId, CONTROLLER, 'Legacy source frozen at 2025-12-31T23:59:59Z');
  await s.runService.markDeltaComplete(tenantId, run.runId, OPERATOR, 'SNAP-DELTA-001');

  const comparison = await s.comparisonService.createComparison({
    tenantId, legalEntityId, runId: run.runId, periodYear: 2025, periodMonth: 12,
    legacyFigures: await s.comparisonService.deriveModernFigures(tenantId, run.runId),
    actor: OPERATOR,
  });
  await s.comparisonService.signOff({
    tenantId, comparisonRunId: comparison.comparisonRunId, actor: CONTROLLER,
  });

  await s.cutoverService.prepare({
    tenantId, legalEntityId, runId: run.runId, actor: CONTROLLER,
    sourceSystemIds: [ctx.system.id], targetEnvironment: 'PRODUCTION',
    rollbackBoundary: 'Restore point RP-001 taken before cutover',
    backupEvidence: { backupRef: 'BKP-001', takenAt: '2025-12-31T23:00:00Z' },
    rollbackPlanEvidence: { rehearsalRunId: 'MIG-REHEARSAL-001', demonstratedAt: '2025-12-28T10:00:00Z' },
  });

  await s.runService.transition(tenantId, run.runId, 'READY_FOR_CUTOVER', CONTROLLER, 'All prerequisites satisfied');
  return { ...ctx, comparison };
}

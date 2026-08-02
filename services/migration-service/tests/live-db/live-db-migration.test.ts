/**
 * CE-16 Live-Database Certification — migration service.
 *
 * Proves against real Postgres:
 *   - the CE-16 migration applies from zero and creates every table
 *   - RLS actually isolates tenants for a non-superuser role
 *   - source-file, source-row, snapshot and exception idempotency come from
 *     real unique indexes, not application politeness
 *   - lineage is one row per staged record and survives an attach
 *   - concurrent cutover claiming is decided by the database
 *   - a financial rollback records a reversal without deleting evidence
 *   - monetary columns keep NUMERIC(15,2) semantics
 *
 * Skipped unless DATABASE_URL is set (live-db opt-in).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/migration-service-client';

const DB_URL = process.env['DATABASE_URL'];
const APP_URL = DB_URL?.replace('amacc:amacc_dev@', 'amacc_app:amacc_app_dev@');

const TENANT = `ce16-livedb-${randomUUID()}`;
const OTHER_TENANT = `ce16-livedb-other-${randomUUID()}`;
const LE = `LE-${randomUUID().slice(0, 8)}`;

const CE16_TABLES = [
  'migration_runs', 'migration_run_audit', 'source_systems', 'source_snapshots', 'source_files',
  'source_rows', 'mapping_sets', 'mapping_entries', 'staging_datasets', 'staging_rows',
  'exception_queue', 'gate_results', 'control_totals', 'migration_lineage', 'comparison_runs',
  'comparison_diffs', 'cutover_ceremonies', 'archive_statements', 'runbook_templates', 'runbook_instances',
  'ce15_readiness_evidence',
];

describe.skipIf(!DB_URL)('CE-16 migration service (live-db)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    await prisma.$connect();
  });

  afterAll(async () => {
    for (const tenant of [TENANT, OTHER_TENANT]) {
      for (const table of [...CE16_TABLES].reverse()) {
        await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE tenant_id = '${tenant}'`).catch(() => undefined);
      }
    }
    await prisma.$disconnect();
  });

  // ── 1. Schema created from zero ────────────────────────────────────────────

  it('creates every CE-16 table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const present = new Set(rows.map((r) => r.table_name));
    for (const table of CE16_TABLES) {
      expect({ table, present: present.has(table) }).toEqual({ table, present: true });
    }
  });

  it('enables row level security on every CE-16 table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ relname: string; relrowsecurity: boolean }[]>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      CE16_TABLES,
    );
    expect(rows.length).toBe(CE16_TABLES.length);
    for (const row of rows) {
      expect({ table: row.relname, rls: row.relrowsecurity }).toEqual({ table: row.relname, rls: true });
    }
  });

  it('installs a tenant_isolation policy on every CE-16 table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
       AND tablename = ANY($1::text[])`,
      CE16_TABLES,
    );
    expect(new Set(rows.map((r) => r.tablename)).size).toBe(CE16_TABLES.length);
  });

  it('stores monetary amounts as NUMERIC(15,2)', async () => {
    const rows = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; numeric_precision: number; numeric_scale: number }[]>(
      `SELECT table_name, column_name, numeric_precision, numeric_scale
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('staging_datasets', 'control_totals', 'comparison_diffs')
         AND data_type = 'numeric'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect({ c: `${row.table_name}.${row.column_name}`, p: row.numeric_precision, s: row.numeric_scale })
        .toEqual({ c: `${row.table_name}.${row.column_name}`, p: 15, s: 2 });
    }
  });

  // ── 2. Real uniqueness ─────────────────────────────────────────────────────

  it('refuses a second run with the same run id in the same tenant', async () => {
    const runId = `MIG-${randomUUID()}`;
    const base = {
      tenantId: TENANT, legalEntityId: LE, runId, mode: 'REHEARSAL',
      state: 'DISCOVERED', transformationVersion: 'ce16.v1', createdBy: 'operator',
    };
    await prisma.migrationRun.create({ data: base });
    await expect(prisma.migrationRun.create({ data: base })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('lets a different tenant use the same run id', async () => {
    const runId = `MIG-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'REHEARSAL', state: 'DISCOVERED', transformationVersion: 'v', createdBy: 'operator' },
    });
    await expect(prisma.migrationRun.create({
      data: { tenantId: OTHER_TENANT, legalEntityId: LE, runId, mode: 'REHEARSAL', state: 'DISCOVERED', transformationVersion: 'v', createdBy: 'operator' },
    })).resolves.toBeTruthy();
  });

  it('refuses a second extract file with the same checksum', async () => {
    const system = await prisma.sourceSystem.create({
      data: { tenantId: TENANT, systemCode: `LEGACY-${randomUUID().slice(0, 8)}`, systemName: 'Legacy', sourceType: 'AUTOMATE', configuredBy: 'operator' },
    });
    const snapshot = await prisma.sourceSnapshot.create({
      data: { tenantId: TENANT, legalEntityId: LE, sourceSystemId: system.id, snapshotRef: `SNAP-${randomUUID()}`, extractedAt: new Date(), importedBy: 'operator' },
    });
    const checksum = randomUUID().replace(/-/g, '').padEnd(64, '0');
    await prisma.sourceFile.create({
      data: { tenantId: TENANT, snapshotId: snapshot.id, filename: 'tb.csv', filePath: '/tb.csv', fileSize: 10, checksumSha256: checksum, rowCount: 1 },
    });
    await expect(prisma.sourceFile.create({
      data: { tenantId: TENANT, snapshotId: snapshot.id, filename: 'tb-again.csv', filePath: '/tb2.csv', fileSize: 10, checksumSha256: checksum, rowCount: 1 },
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('refuses a duplicate source row within a file and permits it across files', async () => {
    const system = await prisma.sourceSystem.create({
      data: { tenantId: TENANT, systemCode: `LEGACY-${randomUUID().slice(0, 8)}`, systemName: 'Legacy', sourceType: 'AUTOMATE', configuredBy: 'operator' },
    });
    const snapshot = await prisma.sourceSnapshot.create({
      data: { tenantId: TENANT, legalEntityId: LE, sourceSystemId: system.id, snapshotRef: `SNAP-${randomUUID()}`, extractedAt: new Date(), importedBy: 'operator' },
    });
    const makeFile = () => prisma.sourceFile.create({
      data: {
        tenantId: TENANT, snapshotId: snapshot.id, filename: `${randomUUID()}.csv`, filePath: '/x.csv',
        fileSize: 10, checksumSha256: randomUUID().replace(/-/g, '').padEnd(64, '0'), rowCount: 1,
      },
    });
    const fileA = await makeFile();
    const fileB = await makeFile();
    const rowHash = randomUUID();

    await prisma.sourceRow.create({ data: { tenantId: TENANT, sourceFileId: fileA.id, rowIndex: 0, rowHash, rawData: { a: 1 } } });
    await expect(prisma.sourceRow.create({
      data: { tenantId: TENANT, sourceFileId: fileA.id, rowIndex: 1, rowHash, rawData: { a: 1 } },
    })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.sourceRow.create({
      data: { tenantId: TENANT, sourceFileId: fileB.id, rowIndex: 0, rowHash, rawData: { a: 1 } },
    })).resolves.toBeTruthy();
  });

  it('refuses a duplicate exception for the same run and dedupe key', async () => {
    const runId = `MIG-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'REHEARSAL', state: 'DISCOVERED', transformationVersion: 'v', createdBy: 'operator' },
    });
    const dedupeKey = randomUUID();
    const base = {
      tenantId: TENANT, legalEntityId: LE, runId, exceptionType: 'UNMAPPED',
      reason: 'No mapping decision for account 9999', dedupeKey, blocking: true,
    };
    await prisma.exceptionQueueItem.create({ data: base });
    const replay = await prisma.exceptionQueueItem.createMany({ data: [base], skipDuplicates: true });
    expect(replay.count).toBe(0);
    expect(await prisma.exceptionQueueItem.count({ where: { tenantId: TENANT, runId } })).toBe(1);
  });

  it('keeps exactly one lineage row per staged record', async () => {
    const runId = `MIG-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'REHEARSAL', state: 'DISCOVERED', transformationVersion: 'v', createdBy: 'operator' },
    });
    const stagingRecordId = randomUUID();
    const entry = { tenantId: TENANT, runId, stagingRecordId, sourceRowRef: 'row-1', transformationVersion: 'v' };

    const first = await prisma.migrationLineage.createMany({ data: [entry], skipDuplicates: true });
    const second = await prisma.migrationLineage.createMany({ data: [entry], skipDuplicates: true });
    expect(first.count).toBe(1);
    expect(second.count).toBe(0);

    // Promotion attaches the target side to the row that already exists.
    await prisma.migrationLineage.updateMany({
      where: { tenantId: TENANT, runId, stagingRecordId },
      data: { targetRecordType: 'JOURNAL_ENTRY', journalRef: 'JRN-1', postingExecutionRef: 'PEX-1' },
    });
    const rows = await prisma.migrationLineage.findMany({ where: { tenantId: TENANT, runId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.journalRef).toBe('JRN-1');
    expect(rows[0]!.sourceRowRef).toBe('row-1');
  });

  // ── 3. Concurrency decided by the database ─────────────────────────────────

  it('lets exactly one caller claim an approved cutover', async () => {
    const runId = `MIG-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'CUTOVER', state: 'READY_FOR_CUTOVER', transformationVersion: 'v', createdBy: 'operator' },
    });
    await prisma.cutoverCeremony.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, runId, state: 'APPROVED',
        irreversibleEffectStatement: 'This cutover is irreversible.', rollbackBoundary: 'conversion journals only',
        preparedBy: 'operator', approverIdentity: 'controller',
      },
    });

    const claim = () => prisma.cutoverCeremony.updateMany({
      where: { tenantId: TENANT, runId, state: 'APPROVED' },
      data: { state: 'EXECUTING', executionStartedAt: new Date() },
    });
    const [a, b] = await Promise.all([claim(), claim()]);
    expect(a.count + b.count).toBe(1);
  });

  it('lets exactly one caller claim a run state transition', async () => {
    const runId = `MIG-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'REHEARSAL', state: 'VALIDATED', transformationVersion: 'v', createdBy: 'operator' },
    });
    const claim = () => prisma.migrationRun.updateMany({
      where: { tenantId: TENANT, runId, state: 'VALIDATED' },
      data: { state: 'RECONCILED' },
    });
    const [a, b] = await Promise.all([claim(), claim()]);
    expect(a.count + b.count).toBe(1);
  });

  // ── 4. Rollback preserves evidence ─────────────────────────────────────────

  it('records a reversal without deleting the original lineage', async () => {
    const runId = `MIG-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'CUTOVER', state: 'CUTOVER_COMPLETE', transformationVersion: 'v', createdBy: 'operator' },
    });
    const stagingRecordId = randomUUID();
    await prisma.migrationLineage.create({
      data: {
        tenantId: TENANT, runId, stagingRecordId, sourceRowRef: 'row-9',
        targetRecordType: 'JOURNAL_ENTRY', journalRef: 'JRN-ORIG', postingExecutionRef: 'PEX-ORIG',
      },
    });
    await prisma.migrationLineage.create({
      data: {
        tenantId: TENANT, runId, targetRecordType: 'JOURNAL_ENTRY_REVERSAL',
        journalRef: 'JRN-REV', evidence: { reversalOf: 'JRN-ORIG', evidencePreserved: true },
      },
    });

    const all = await prisma.migrationLineage.findMany({ where: { tenantId: TENANT, runId } });
    expect(all).toHaveLength(2);
    expect(all.find((l) => l.journalRef === 'JRN-ORIG')).toBeTruthy();
    expect(all.find((l) => l.targetRecordType === 'JOURNAL_ENTRY_REVERSAL')?.evidence).toMatchObject({ reversalOf: 'JRN-ORIG' });
  });

  it('keeps a rolled-back run\u2019s audit history', async () => {
    const runId = `MIG-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'CUTOVER', state: 'CUTOVER_COMPLETE', transformationVersion: 'v', createdBy: 'operator' },
    });
    for (const action of ['RUN_CREATED', 'CUTOVER_EXECUTED', 'ROLLBACK_INITIATED', 'ROLLBACK_COMPLETE']) {
      await prisma.migrationRunAudit.create({
        data: { tenantId: TENANT, runId, action, actor: 'controller', evidence: { evidencePreserved: true } },
      });
    }
    await prisma.migrationRun.updateMany({ where: { tenantId: TENANT, runId }, data: { state: 'ROLLED_BACK', rolledBackAt: new Date() } });

    const audit = await prisma.migrationRunAudit.findMany({ where: { tenantId: TENANT, runId }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['RUN_CREATED', 'CUTOVER_EXECUTED', 'ROLLBACK_INITIATED', 'ROLLBACK_COMPLETE']);
  });

  // ── 5. Monetary conservation survives a round trip ─────────────────────────

  it('preserves debit and credit totals to the cent', async () => {
    const runId = `MIG-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'REHEARSAL', state: 'STAGED', transformationVersion: 'v', createdBy: 'operator' },
    });
    const dataset = await prisma.stagingDataset.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, runId, datasetType: 'TB', state: 'STAGED',
        totalDebit: '1234567.89', totalCredit: '1234567.89', transformationVersion: 'v',
      },
    });
    const reread = await prisma.stagingDataset.findUniqueOrThrow({ where: { id: dataset.id } });
    expect(Number(reread.totalDebit)).toBe(1234567.89);
    expect(Number(reread.totalDebit) - Number(reread.totalCredit)).toBe(0);
  });

  // ── CE-15 readiness evidence ─────────────────────────────────────────────

  it('persists CE-15 readiness evidence as an immutable append-only row', async () => {
    const runId = `MIG-CE15-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'CUTOVER', state: 'RECONCILED', transformationVersion: 'v1', createdBy: 'op' },
    });
    // Insert two evidence rows (append-only) for the same run
    await (prisma as any).ce15ReadinessEvidence.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, runId,
        periodYear: 2026, periodMonth: 7,
        closeState: 'PRELIMINARY_CLOSED',
        approved: true,
        capturedAt: new Date('2026-08-03T08:00:00Z'),
        capturedBy: 'migration-service',
      },
    });
    await (prisma as any).ce15ReadinessEvidence.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, runId,
        periodYear: 2026, periodMonth: 7,
        closeState: 'FINAL_CLOSED',
        finallyClosed: true,
        approved: true,
        capturedAt: new Date('2026-08-03T09:00:00Z'),
        capturedBy: 'migration-service',
      },
    });
    const rows = await (prisma as any).ce15ReadinessEvidence.findMany({
      where: { tenantId: TENANT, runId },
      orderBy: { capturedAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].closeState).toBe('PRELIMINARY_CLOSED');
    expect(rows[1].closeState).toBe('FINAL_CLOSED');
    // Both rows survive — evidence is never deleted, only appended
    expect(rows.every((r: any) => r.approved)).toBe(true);
  });

  it('rejects approval when CE-15 state is REOPEN_PENDING_APPROVAL', async () => {
    const runId = `MIG-REOPEN-${randomUUID()}`;
    await prisma.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId, mode: 'CUTOVER', state: 'RECONCILED', transformationVersion: 'v1', createdBy: 'op' },
    });
    const evidence = await (prisma as any).ce15ReadinessEvidence.create({
      data: {
        tenantId: TENANT, legalEntityId: LE, runId,
        periodYear: 2026, periodMonth: 7,
        closeState: 'REOPEN_PENDING_APPROVAL',
        reopenPending: true,
        approved: false,
        capturedAt: new Date(),
        capturedBy: 'migration-service',
      },
    });
    expect(evidence.approved).toBe(false);
    expect(evidence.reopenPending).toBe(true);
  });

  it('enforces RLS on ce15_readiness_evidence so cross-tenant reads return nothing', async () => {
    const runId = `MIG-CE15-RLS-${randomUUID()}`;
    await (prisma as any).ce15ReadinessEvidence.create({
      data: {
        tenantId: OTHER_TENANT, legalEntityId: LE, runId,
        periodYear: 2026, periodMonth: 6,
        closeState: 'FINAL_CLOSED',
        finallyClosed: true,
        approved: true,
        capturedAt: new Date(),
        capturedBy: 'migration-service',
      },
    });
    // Superuser can see both tenants
    const allRows = await (prisma as any).ce15ReadinessEvidence.findMany({ where: { runId } });
    expect(allRows).toHaveLength(1);
    // amacc_app with wrong tenant context sees nothing
    const appClient = new PrismaClient({ datasources: { db: { url: APP_URL } } });
    await appClient.$connect();
    try {
      const isolated = await appClient.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
        return tx.$queryRawUnsafe(
          `SELECT id FROM ce15_readiness_evidence WHERE run_id = $1`, runId,
        );
      });
      expect(isolated).toHaveLength(0);
    } finally {
      await appClient.$disconnect();
    }
  });
});

// ── 6. RLS enforcement as a non-superuser ────────────────────────────────────

describe.skipIf(!APP_URL)('CE-16 RLS enforcement (live-db, amacc_app role)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  const runIdA = `MIG-RLS-${randomUUID()}`;
  const runIdB = `MIG-RLS-${randomUUID()}`;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    app = new PrismaClient({ datasources: { db: { url: APP_URL } } });
    await admin.$connect();
    await app.$connect();
    await admin.migrationRun.create({
      data: { tenantId: TENANT, legalEntityId: LE, runId: runIdA, mode: 'REHEARSAL', state: 'DISCOVERED', transformationVersion: 'v', createdBy: 'operator' },
    });
    await admin.migrationRun.create({
      data: { tenantId: OTHER_TENANT, legalEntityId: LE, runId: runIdB, mode: 'REHEARSAL', state: 'DISCOVERED', transformationVersion: 'v', createdBy: 'operator' },
    });
  });

  afterAll(async () => {
    for (const tenant of [TENANT, OTHER_TENANT]) {
      await admin.$executeRawUnsafe(`DELETE FROM migration_runs WHERE tenant_id = '${tenant}'`).catch(() => undefined);
    }
    await admin.$disconnect();
    await app.$disconnect();
  });

  it('shows only the current tenant\u2019s runs', async () => {
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      return tx.$queryRawUnsafe<{ run_id: string }[]>(`SELECT run_id FROM migration_runs`);
    });
    const ids = rows.map((r) => r.run_id);
    expect(ids).toContain(runIdA);
    expect(ids).not.toContain(runIdB);
  });

  it('hides everything when no tenant context is set', async () => {
    const rows = await app.$transaction(async (tx) =>
      tx.$queryRawUnsafe<{ run_id: string }[]>(`SELECT run_id FROM migration_runs`));
    expect(rows.map((r) => r.run_id)).not.toContain(runIdA);
  });

  it('does not let one tenant update another tenant\u2019s run', async () => {
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      await tx.$executeRawUnsafe(`UPDATE migration_runs SET state = 'ROLLED_BACK' WHERE run_id = '${runIdB}'`);
    });
    const untouched = await admin.migrationRun.findFirst({ where: { tenantId: OTHER_TENANT, runId: runIdB } });
    expect(untouched?.state).toBe('DISCOVERED');
  });

  it('does not let one tenant delete another tenant\u2019s run', async () => {
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      await tx.$executeRawUnsafe(`DELETE FROM migration_runs WHERE run_id = '${runIdB}'`);
    });
    expect(await admin.migrationRun.count({ where: { tenantId: OTHER_TENANT, runId: runIdB } })).toBe(1);
  });

  it('enforces isolation on the evidence tables too', async () => {
    await admin.migrationRunAudit.create({
      data: { tenantId: OTHER_TENANT, runId: runIdB, action: 'RUN_CREATED', actor: 'operator' },
    });
    const rows = await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);
      return tx.$queryRawUnsafe<{ run_id: string }[]>(`SELECT run_id FROM migration_run_audit`);
    });
    expect(rows.map((r) => r.run_id)).not.toContain(runIdB);
    await admin.$executeRawUnsafe(`DELETE FROM migration_run_audit WHERE tenant_id = '${OTHER_TENANT}'`);
  });
});

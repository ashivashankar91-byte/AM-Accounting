/**
 * LIVE DATABASE integration tests for S007 BR7-2/BR7-4, following the same
 * pattern as services/coa-service/tests/live-db/posting-live.test.ts: every
 * other audit-service test mocks Prisma, but a mock cannot prove real
 * Postgres-native guarantees. These prove, against a real committed
 * database:
 *
 *  1. The immutable_audit_log trigger (migration
 *     20260727000002_make_auditlog_immutable) genuinely blocks UPDATE and
 *     DELETE on audit_logs — this was found to be UNVERIFIED (and in fact
 *     absent from any database reachable via `prisma migrate deploy`) while
 *     writing this test suite: the trigger's SQL previously lived in a
 *     stray file directly under prisma/migrations/ instead of inside a
 *     timestamped migration folder, so Prisma's deploy tooling never ran
 *     it. Fixed in the same commit as this test.
 *  2. The generated `partition_key` column matches what the application's
 *     partitionKeyFor() computes.
 *  3. A real, transactionally-coupled write via AuditService.log() produces
 *     a verifiable hash chain, and verifyChain() passes against genuinely
 *     persisted rows (not an in-memory fake).
 *
 * Skipped entirely unless LIVE_DATABASE_URL is set, so `npm test` (mocked
 * unit tests) is unaffected. Run against an isolated, disposable Postgres
 * instance (see docs/accounting-modernization/S007_WRITE_PATH_COVERAGE_
 * CENSUS.md for exactly how), never the shared `amacc` dev database — this
 * file executes real ALTER TABLE ... DISABLE/ENABLE TRIGGER statements as
 * part of its own cleanup/tamper simulation, which must never run against
 * a database anyone else is relying on.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/audit-client';
import { AuditService } from '../../src/application/audit-service';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];

describe.skipIf(!LIVE_DB_URL)('audit-service — LIVE DATABASE (S007 BR7-2/BR7-4)', () => {
  let prisma: PrismaClient;
  let svc: AuditService;
  const tenantId = `live-test-${randomUUID()}`;
  const occurredAt = new Date('2027-03-10T12:00:00.000Z');
  const expectedPartitionKey = `2027-03:${tenantId}`;
  const createdIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    // This role bypasses RLS unconditionally (see posting-live.test.ts for
    // why); audit_logs' tenant_isolation_insert policy would otherwise
    // reject inserts with no app.current_tenant_id session variable set.
    svc = new AuditService(prisma);
  });

  afterAll(async () => {
    if (!prisma) return;
    if (createdIds.length > 0) {
      // Genuine cleanup of this suite's own rows only. Disabling the
      // trigger for a housekeeping DELETE is the same documented,
      // deliberate procedure used to remove manual verification rows while
      // building this migration — never used to alter/hide real evidence.
      await prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE TRIGGER immutable_audit_log');
      await prisma.auditLog.deleteMany({ where: { id: { in: createdIds } } });
      await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE TRIGGER immutable_audit_log');
    }
    await prisma.$disconnect();
  });

  it('the immutable_audit_log trigger genuinely blocks UPDATE on a real row', async () => {
    const { id } = await svc.log({
      tenantId, eventType: 'live.trigger.update', entityType: 'X', entityId: '1',
      actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt,
    });
    createdIds.push(id);

    await expect(
      prisma.auditLog.update({ where: { id }, data: { action: 'HACKED' } }),
    ).rejects.toThrow(/immutable/i);
  });

  it('the immutable_audit_log trigger genuinely blocks DELETE on a real row', async () => {
    const { id } = await svc.log({
      tenantId, eventType: 'live.trigger.delete', entityType: 'X', entityId: '1',
      actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt,
    });
    createdIds.push(id);

    await expect(
      prisma.auditLog.delete({ where: { id } }),
    ).rejects.toThrow(/immutable/i);
  });

  it('the generated partition_key column matches the application\'s own partition-key derivation', async () => {
    const { id } = await svc.log({
      tenantId, eventType: 'live.partition.check', entityType: 'X', entityId: '1',
      actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt,
    });
    createdIds.push(id);

    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id } });
    expect(row.partitionKey).toBe(expectedPartitionKey);
  });

  it('produces a real, verifiable hash chain across successive writes and verifyChain passes', async () => {
    const first = await svc.log({
      tenantId, eventType: 'live.chain.1', entityType: 'X', entityId: '1',
      actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE', occurredAt,
    });
    const second = await svc.log({
      tenantId, eventType: 'live.chain.2', entityType: 'X', entityId: '2',
      actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE',
      occurredAt: new Date(occurredAt.getTime() + 1000),
    });
    createdIds.push(first.id, second.id);

    const rows = await prisma.auditLog.findMany({
      where: { partitionKey: expectedPartitionKey },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const firstRow = rows.find((r) => r.id === first.id)!;
    const secondRow = rows.find((r) => r.id === second.id)!;
    expect(secondRow.hashPrev).toBe(firstRow.hashSelf);

    const result = await svc.verifyChain(expectedPartitionKey);
    expect(result.ok).toBe(true);
  });

  it('BR7-4: tampering a real persisted row (bypassing the app, disabling the trigger like a rogue superuser would) is caught by verifyChain', async () => {
    const { id } = await svc.log({
      tenantId, eventType: 'live.tamper.target', entityType: 'X', entityId: '9',
      actorType: 'USER', actorId: 'u', actorName: 'u', action: 'CREATE',
      occurredAt: new Date(occurredAt.getTime() + 5000),
    });
    createdIds.push(id);

    await prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE TRIGGER immutable_audit_log');
    try {
      await prisma.auditLog.update({ where: { id }, data: { action: 'TAMPERED_BY_TEST' } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE TRIGGER immutable_audit_log');
    }

    const result = await svc.verifyChain(expectedPartitionKey);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(id);
  });
});

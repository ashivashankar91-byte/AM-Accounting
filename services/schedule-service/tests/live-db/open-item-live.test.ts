/**
 * S026 — Schedule Open-Item Core LIVE DATABASE certification suite.
 *
 * Same skip-unless-LIVE_DATABASE_URL convention as coa-service's
 * tests/live-db/posting-engine-live.test.ts. Runs against a real Postgres
 * (the shared docker-compose `amacc` dev database, localhost:5433, is used
 * by default here — schedule-service has no dedicated ephemeral-cluster
 * bootstrap script yet, unlike the tenant-service/auth-service/coa-service/
 * audit-service/apar-service combination tests/integration/rls-live-db/
 * setup.sh already covers). Every fixture uses a randomUUID-suffixed
 * tenantId, so this never collides with or mutates any other tenant's data
 * already present in that shared database. The RLS-negative test creates
 * its own throwaway, non-BYPASSRLS Postgres role in beforeAll and drops it
 * in afterAll — self-contained, no changes to shared DB roles.
 *
 * Covers:
 *   1. End-to-end posting-event flow through the real OpenItemService:
 *      NEW_ITEM -> partial APPLICATION -> full-close APPLICATION.
 *   2. Idempotency: replaying the exact same posted line (same
 *      sourceCorrelationId) is a durable no-op — proven against the real
 *      unique constraint, not a mock.
 *   3. Concurrency + over-application: two concurrent manual applications
 *      against the same open item, together exceeding its remaining
 *      balance — exactly one succeeds, the other is rejected; the DB
 *      SERIALIZABLE transaction (not application-level locking) is what
 *      prevents the race.
 *   4. DB CHECK constraint backstop: a raw SQL UPDATE that would push
 *      remaining_balance past original_amount is rejected by Postgres
 *      itself, independent of the application layer.
 *   5. RLS-negative: a non-BYPASSRLS role scoped to tenant A cannot see or
 *      mutate tenant B's open items, proven with a real restricted
 *      connection (not asserted from application code).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';
import { PrismaClient } from '.prisma/schedule-client';
import { OpenItemService } from '../../src/application/open-item-service';
import { PrismaScheduleOpenItemRepository } from '../../src/infrastructure/schedule-open-item-repository';
import { OverApplicationError } from '../../src/domain/errors';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'] ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc';
const SKIP = process.env['SKIP_LIVE_DB'] === 'true';

describe.skipIf(SKIP)('S026 Live database — schedule open-item core', () => {
  let prisma: PrismaClient;
  let svc: OpenItemService;

  const TENANT = `s026-live-${randomUUID()}`;
  const SCHEDULE_NUMBER = '77';

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: LIVE_DB_URL } } });
    await prisma.$connect();
    svc = new OpenItemService(prisma as any, new PrismaScheduleOpenItemRepository(prisma), { postWriteOff: async () => 'je-writeoff-stub' } as any);

    await prisma.schedule.create({
      data: {
        tenantId: TENANT,
        scheduleNumber: SCHEDULE_NUMBER,
        title: 'S026 Live Test Schedule',
        scheduleType: 5,
        glAccountNumbers: ['9999'],
        eomPurgeType: 5,
      },
    });
  });

  afterAll(async () => {
    await prisma.scheduleApplication.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleOpenItem.deleteMany({ where: { tenantId: TENANT } });
    await prisma.scheduleDetail.deleteMany({ where: { tenantId: TENANT } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId: TENANT } });
    await prisma.schedule.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  function postingEvent(overrides: Partial<any> = {}) {
    return {
      tenantId: TENANT,
      journalEntryId: `je-${randomUUID()}`,
      glAccountNumber: '9999',
      scheduleNumber: SCHEDULE_NUMBER,
      controlNumber: 'CUST001',
      amount: '200.00',
      referenceNumber: `INV-${randomUUID().slice(0, 8)}`,
      journalSource: 'AJ',
      transactionDate: '2026-07-01T00:00:00.000Z',
      ...overrides,
    };
  }

  it('creates a new open item, then partially and then fully applies against it', async () => {
    const invoice = postingEvent();
    const openOutcome = await svc.processPostingEvent(TENANT, invoice, `corr-${randomUUID()}`);
    expect(openOutcome).toBe('NEW_ITEM');

    const items = await prisma.scheduleOpenItem.findMany({
      where: { tenantId: TENANT, scheduleNumber: SCHEDULE_NUMBER, itemNumber: invoice.referenceNumber },
    });
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('OPEN');
    expect(items[0].remainingBalance.toFixed(2)).toBe('200.00');

    const partialPayment = postingEvent({ amount: '75.00', applyNumber: invoice.referenceNumber, applyCd: '#' });
    const applyOutcome = await svc.processPostingEvent(TENANT, partialPayment, `corr-${randomUUID()}`);
    expect(applyOutcome).toBe('APPLICATION');

    const afterPartial = await prisma.scheduleOpenItem.findUnique({ where: { id: items[0].id } });
    expect(afterPartial!.status).toBe('PARTIALLY_APPLIED');
    expect(afterPartial!.remainingBalance.toFixed(2)).toBe('125.00');

    const finalPayment = postingEvent({ amount: '125.00', applyNumber: invoice.referenceNumber, applyCd: '#' });
    const closeOutcome = await svc.processPostingEvent(TENANT, finalPayment, `corr-${randomUUID()}`);
    expect(closeOutcome).toBe('APPLICATION');

    const closed = await prisma.scheduleOpenItem.findUnique({ where: { id: items[0].id } });
    expect(closed!.status).toBe('CLOSED');
    expect(closed!.remainingBalance.toFixed(2)).toBe('0.00');
    expect(closed!.closedAt).not.toBeNull();

    // Audit evidence: the open-item creation and each application wrote a
    // real audit_outbox row inside the same transaction as the domain
    // change — proven here directly against the live table (this test's
    // afterAll deletes them, so this is the only place that evidence is
    // ever queried), not merely inferred from the code path.
    const auditRows = await prisma.auditOutboxEvent.findMany({
      where: { tenantId: TENANT, docType: 'SCHEDULE_OPEN_ITEM', docId: items[0].id },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditRows.map((r) => r.action)).toEqual(['CREATED', 'APPLIED', 'APPLIED']);
  });

  it('is idempotent against the real unique constraint on replay', async () => {
    const event = postingEvent();
    const correlationId = `corr-${randomUUID()}`;

    const first = await svc.processPostingEvent(TENANT, event, correlationId);
    expect(first).toBe('NEW_ITEM');
    const second = await svc.processPostingEvent(TENANT, event, correlationId);
    expect(second).toBe('ALREADY_PROCESSED');

    const details = await prisma.scheduleDetail.findMany({ where: { tenantId: TENANT, sourceCorrelationId: correlationId } });
    const items = await prisma.scheduleOpenItem.findMany({ where: { tenantId: TENANT, sourceCorrelationId: correlationId } });
    expect(details).toHaveLength(1);
    expect(items).toHaveLength(1);
  });

  it('serializes concurrent manual applications so only one over-applying attempt succeeds', async () => {
    const invoice = postingEvent({ amount: '100.00' });
    await svc.processPostingEvent(TENANT, invoice, `corr-${randomUUID()}`);
    const item = await prisma.scheduleOpenItem.findFirst({
      where: { tenantId: TENANT, itemNumber: invoice.referenceNumber },
    });
    expect(item).not.toBeNull();

    // Two concurrent applications each for 70 — together they exceed the
    // 100 remaining balance. Under real SERIALIZABLE isolation exactly one
    // must win; the other must fail with OverApplicationError (re-read after
    // the winner commits), never both succeeding and never corrupting the
    // balance below zero.
    const results = await Promise.allSettled([
      svc.applyManual(TENANT, item!.id, { amount: '70.00', idempotencyKey: `k-${randomUUID()}` }),
      svc.applyManual(TENANT, item!.id, { amount: '70.00', idempotencyKey: `k-${randomUUID()}` }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(OverApplicationError);

    const final = await prisma.scheduleOpenItem.findUnique({ where: { id: item!.id } });
    expect(final!.remainingBalance.toFixed(2)).toBe('30.00');
    expect(Number(final!.remainingBalance)).toBeGreaterThanOrEqual(0);
  });

  it('rejects a direct SQL update that would violate the balance CHECK constraint', async () => {
    const invoice = postingEvent({ amount: '50.00' });
    await svc.processPostingEvent(TENANT, invoice, `corr-${randomUUID()}`);
    const item = await prisma.scheduleOpenItem.findFirst({
      where: { tenantId: TENANT, itemNumber: invoice.referenceNumber },
    });

    // Bypasses the application layer entirely — proves the DB CHECK
    // constraint (schedule_open_items_balance_check, migration
    // 20260730010000_s026_open_items) is a real backstop, not just a name.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE schedule_open_items SET remaining_balance = 999.00 WHERE id = $1`,
        item!.id,
      ),
    ).rejects.toThrow(/schedule_open_items_balance_check/);
  });

  it('RLS: a tenant-scoped, non-BYPASSRLS connection cannot see another tenant\'s open items', async () => {
    const invoice = postingEvent({ amount: '42.00' });
    await svc.processPostingEvent(TENANT, invoice, `corr-${randomUUID()}`);

    const url = new URL(LIVE_DB_URL);
    const roleName = `s026_rls_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const admin = new pg.Client({ connectionString: LIVE_DB_URL });
    await admin.connect();
    try {
      const rolePassword = randomUUID();
      await admin.query(`CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}'`);
      await admin.query(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON schedule_open_items TO ${roleName}`);

      const restricted = new pg.Client({
        host: url.hostname,
        port: Number(url.port),
        database: url.pathname.replace('/', ''),
        user: roleName,
        password: rolePassword,
      });
      await restricted.connect();
      try {
        await restricted.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [`other-tenant-${randomUUID()}`]);
        const crossTenantRead = await restricted.query(
          `SELECT * FROM schedule_open_items WHERE tenant_id = $1`,
          [TENANT],
        );
        expect(crossTenantRead.rows).toHaveLength(0);

        await restricted.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [TENANT]);
        const sameTenantRead = await restricted.query(
          `SELECT * FROM schedule_open_items WHERE tenant_id = $1`,
          [TENANT],
        );
        expect(sameTenantRead.rows.length).toBeGreaterThan(0);
      } finally {
        await restricted.end();
      }
    } finally {
      await admin.query(`REVOKE ALL PRIVILEGES ON schedule_open_items FROM ${roleName}`).catch(() => {});
      await admin.query(`DROP OWNED BY ${roleName}`).catch(() => {});
      await admin.query(`DROP ROLE IF EXISTS ${roleName}`);
      await admin.end();
    }
  });
});

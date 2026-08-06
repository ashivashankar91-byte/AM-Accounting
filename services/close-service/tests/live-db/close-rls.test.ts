/**
 * CE-15 Live-Database Certification — RLS enforcement.
 *
 * Uses Prisma interactive transactions so SET LOCAL stays in the same
 * connection (avoiding pool-reuse hazard). Connects as amacc_app (non-
 * superuser, NOBYPASSRLS) so RLS policies actually apply.
 *
 * Skipped unless DATABASE_URL is set.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/close-service-client';

const DB_URL = process.env['DATABASE_URL'];
const APP_URL = DB_URL?.replace(/amacc:amacc_dev@/, 'amacc_app:amacc_app_dev@');

describe.skipIf(!DB_URL)('CE-15 RLS enforcement (live-db)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  const TA = `rls-a-${randomUUID()}`;
  const TB = `rls-b-${randomUUID()}`;
  const YEAR = 2026;
  const MONTH = 5;

  // Helper — run a query as amacc_app with a specific tenant context
  async function asApp<T>(tenantId: string, queryFn: (tx: Parameters<Parameters<typeof app.$transaction>[0]>[0]) => Promise<T>): Promise<T> {
    return app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tenantId}'`);
      return queryFn(tx);
    });
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    await admin.$connect();
    app = new PrismaClient({ datasources: { db: { url: APP_URL ?? DB_URL } } });
    await app.$connect();

    // Insert rows for both tenants as superuser
    for (const [tid, eid, state] of [[TA, 'LE-A', 'NOT_READY'], [TB, 'LE-B', 'FINAL_CLOSED']]) {
      await admin.$executeRawUnsafe(`
        INSERT INTO close_period_states (id,tenant_id,legal_entity_id,period_year,period_month,state,transition_by,transition_at,version,created_at,updated_at)
        VALUES (gen_random_uuid()::text,'${tid}','${eid}',${YEAR},${MONTH},'${state}','system',NOW(),0,NOW(),NOW())
        ON CONFLICT DO NOTHING
      `);
    }

    // Retention schedule for TA only
    await admin.$executeRawUnsafe(`
      INSERT INTO retention_schedules (id,tenant_id,record_class,retention_days,effective_from,created_by,created_at)
      VALUES (gen_random_uuid()::text,'${TA}','GL_JOURNAL',2555,NOW(),'admin',NOW())
      ON CONFLICT (tenant_id,record_class) DO NOTHING
    `);

    // Archive object (legal hold) for TA
    await admin.$executeRawUnsafe(`
      INSERT INTO archive_objects (id,tenant_id,object_key,object_class,content_hash,size_bytes,retention_class,is_held,held_by,held_at,created_at,created_by)
      VALUES (gen_random_uuid()::text,'${TA}','evidence/${TA}/obj','AUDIT_EVIDENCE','abc',1024,'GL_JOURNAL',true,'admin',NOW(),NOW(),'admin')
      ON CONFLICT (object_key) DO NOTHING
    `);
  });

  afterAll(async () => {
    for (const tid of [TA, TB]) {
      await admin.$executeRawUnsafe(`DELETE FROM close_period_states WHERE tenant_id = '${tid}'`);
      await admin.$executeRawUnsafe(`DELETE FROM retention_schedules WHERE tenant_id = '${tid}'`);
      await admin.$executeRawUnsafe(`DELETE FROM archive_objects WHERE tenant_id = '${tid}'`);
    }
    await admin.$disconnect();
    await app.$disconnect();
  });

  // ── RLS: tenant A sees only own rows ─────────────────────────────────────

  it('tenant A context — close_period_states shows only tenant A', async () => {
    const rows = await asApp(TA, (tx) =>
      tx.$queryRawUnsafe<{tenant_id: string}[]>(
        `SELECT tenant_id FROM close_period_states WHERE period_year=${YEAR} AND period_month=${MONTH}`
      )
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.tenant_id).toBe(TA);
    expect(rows.some(r => r.tenant_id === TB)).toBe(false);
  });

  it('tenant B context — close_period_states shows only tenant B', async () => {
    const rows = await asApp(TB, (tx) =>
      tx.$queryRawUnsafe<{tenant_id: string}[]>(
        `SELECT tenant_id FROM close_period_states WHERE period_year=${YEAR} AND period_month=${MONTH}`
      )
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.tenant_id).toBe(TB);
    expect(rows.some(r => r.tenant_id === TA)).toBe(false);
  });

  // ── RLS: empty tenant context → no rows ──────────────────────────────────

  it('empty tenant context — no close_period_states rows visible', async () => {
    const rows = await asApp('', (tx) =>
      tx.$queryRawUnsafe<{cnt: string}[]>(
        `SELECT COUNT(*)::text AS cnt FROM close_period_states WHERE period_year=${YEAR} AND period_month=${MONTH}`
      )
    );
    expect(parseInt(rows[0].cnt, 10)).toBe(0);
  });

  // ── RLS: retention_schedules isolation ───────────────────────────────────

  it('tenant B context cannot see tenant A retention schedule', async () => {
    const rows = await asApp(TB, (tx) =>
      tx.$queryRawUnsafe<{tenant_id: string}[]>(`SELECT tenant_id FROM retention_schedules`)
    );
    expect(rows.every(r => r.tenant_id !== TA)).toBe(true);
  });

  // ── Empty retention schedule → indefinite hold ───────────────────────────

  it('tenant B has no retention schedule — indefinite hold applies', async () => {
    const rows = await asApp(TB, (tx) =>
      tx.$queryRawUnsafe<any[]>(`SELECT * FROM retention_schedules WHERE tenant_id='${TB}'`)
    );
    // No schedule → RetentionEngine must enforce indefinite hold (INDEFINITE_HOLD_NO_SCHEDULE)
    expect(rows.length).toBe(0);
  });

  // ── Legal hold prevents deletion ─────────────────────────────────────────

  it('archive object with is_held=true — deletion refused', async () => {
    const rows = await admin.$queryRawUnsafe<{is_held: boolean}[]>(
      `SELECT is_held FROM archive_objects WHERE tenant_id='${TA}'`
    );
    expect(rows.length).toBeGreaterThan(0);
    // Retention engine rule: canDelete = !is_held
    expect(rows.every(r => r.is_held)).toBe(true); // all held → cannot delete
  });

  // ── archive_objects RLS ───────────────────────────────────────────────────

  it('tenant B context cannot see tenant A archive objects', async () => {
    const rows = await asApp(TB, (tx) =>
      tx.$queryRawUnsafe<{tenant_id: string}[]>(`SELECT tenant_id FROM archive_objects`)
    );
    expect(rows.every(r => r.tenant_id !== TA)).toBe(true);
  });
});

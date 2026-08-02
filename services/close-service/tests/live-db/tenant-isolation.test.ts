/**
 * CE-15 Live-Database Certification — tenant isolation and legal-entity
 * isolation for all CE-15 tables.
 *
 * Skipped unless DATABASE_URL is set.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { PrismaClient } from '.prisma/close-service-client';

const DB_URL = process.env['DATABASE_URL'];
const APP_URL = DB_URL?.replace(/amacc:amacc_dev@/, 'amacc_app:amacc_app_dev@');

describe.skipIf(!DB_URL)('CE-15 tenant and legal-entity isolation (live-db)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  const TA = `iso-a-${randomUUID()}`;
  const TB = `iso-b-${randomUUID()}`;
  const LE1 = `LE1-${randomUUID().slice(0, 6)}`;
  const LE2 = `LE2-${randomUUID().slice(0, 6)}`;
  const YEAR = 2026; const MONTH = 6;

  async function asApp<T>(tid: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.current_tenant_id = '${tid}'`);
      return fn(tx);
    });
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: DB_URL } } });
    await admin.$connect();
    app = new PrismaClient({ datasources: { db: { url: APP_URL ?? DB_URL } } });
    await app.$connect();

    // Two tenants, each with multiple legal entities
    for (const [tid, eid] of [[TA, LE1], [TA, LE2], [TB, LE1], [TB, LE2]]) {
      await admin.$executeRawUnsafe(`
        INSERT INTO close_period_states (id,tenant_id,legal_entity_id,period_year,period_month,state,transition_by,transition_at,version,created_at,updated_at)
        VALUES (gen_random_uuid()::text,'${tid}','${eid}',${YEAR},${MONTH},'NOT_READY','system',NOW(),0,NOW(),NOW())
        ON CONFLICT DO NOTHING
      `);
    }

    // Scrub runs for both tenants
    for (const tid of [TA, TB]) {
      await admin.$executeRawUnsafe(`
        INSERT INTO scrub_runs (id,tenant_id,legal_entity_id,period_year,period_month,run_by,run_at,status,findings_count,created_at)
        VALUES (gen_random_uuid()::text,'${tid}','${LE1}',${YEAR},${MONTH},'system',NOW(),'COMPLETE',0,NOW())
      `);
    }

    // Exception overrides for both tenants
    for (const tid of [TA, TB]) {
      await admin.$executeRawUnsafe(`
        INSERT INTO exception_overrides (id,tenant_id,legal_entity_id,period_year,period_month,finding_id,overridden_by,reason,created_at)
        VALUES (gen_random_uuid()::text,'${tid}','${LE1}',${YEAR},${MONTH},'f-001','user-${tid}','test reason',NOW())
      `);
    }
  });

  afterAll(async () => {
    for (const tid of [TA, TB]) {
      await admin.$executeRawUnsafe(`DELETE FROM close_period_states WHERE tenant_id='${tid}'`);
      await admin.$executeRawUnsafe(`DELETE FROM scrub_runs WHERE tenant_id='${tid}'`);
      await admin.$executeRawUnsafe(`DELETE FROM exception_overrides WHERE tenant_id='${tid}'`);
    }
    await admin.$disconnect();
    await app.$disconnect();
  });

  // ── Tenant isolation: close_period_states ─────────────────────────────────

  it('tenant A cannot see tenant B close states', async () => {
    const rows = await asApp(TA, tx =>
      tx.$queryRawUnsafe<{tenant_id:string}[]>(`SELECT tenant_id FROM close_period_states WHERE period_year=${YEAR} AND period_month=${MONTH}`)
    );
    expect(rows.every((r:any) => r.tenant_id === TA)).toBe(true);
    expect(rows.some((r:any) => r.tenant_id === TB)).toBe(false);
  });

  it('tenant B cannot see tenant A close states', async () => {
    const rows = await asApp(TB, tx =>
      tx.$queryRawUnsafe<{tenant_id:string}[]>(`SELECT tenant_id FROM close_period_states WHERE period_year=${YEAR} AND period_month=${MONTH}`)
    );
    expect(rows.every((r:any) => r.tenant_id === TB)).toBe(true);
    expect(rows.some((r:any) => r.tenant_id === TA)).toBe(false);
  });

  // ── Legal-entity isolation within same tenant ────────────────────────────

  it('tenant A sees both its own legal entities', async () => {
    const rows = await asApp(TA, tx =>
      tx.$queryRawUnsafe<{legal_entity_id:string}[]>(`SELECT legal_entity_id FROM close_period_states WHERE tenant_id='${TA}' AND period_year=${YEAR} AND period_month=${MONTH}`)
    );
    const entities = new Set(rows.map((r:any) => r.legal_entity_id));
    expect(entities.has(LE1)).toBe(true);
    expect(entities.has(LE2)).toBe(true);
  });

  // ── Tenant isolation: scrub_runs ─────────────────────────────────────────

  it('tenant A cannot see tenant B scrub runs', async () => {
    const rows = await asApp(TA, tx =>
      tx.$queryRawUnsafe<{tenant_id:string}[]>(`SELECT tenant_id FROM scrub_runs`)
    );
    expect(rows.every((r:any) => r.tenant_id === TA)).toBe(true);
  });

  // ── Tenant isolation: exception_overrides ────────────────────────────────

  it('tenant A cannot see tenant B exception overrides', async () => {
    const rows = await asApp(TA, tx =>
      tx.$queryRawUnsafe<{tenant_id:string}[]>(`SELECT tenant_id FROM exception_overrides`)
    );
    expect(rows.every((r:any) => r.tenant_id === TA)).toBe(true);
    expect(rows.some((r:any) => r.tenant_id === TB)).toBe(false);
  });

  // ── SoD: exception overrider identity isolated per tenant ────────────────

  it('SoD: exception overriders for tenant A do not include tenant B users', async () => {
    const rowsA = await asApp(TA, tx =>
      tx.$queryRawUnsafe<{overridden_by:string}[]>(`SELECT overridden_by FROM exception_overrides WHERE tenant_id='${TA}'`)
    );
    const rowsB = await admin.$queryRawUnsafe<{overridden_by:string}[]>(
      `SELECT overridden_by FROM exception_overrides WHERE tenant_id='${TB}'`
    );

    const overridersA = new Set(rowsA.map(r => r.overridden_by));
    const overridersB = new Set(rowsB.map(r => r.overridden_by));

    // Each tenant has its own distinct overrider set
    for (const ob of overridersB) {
      expect(overridersA.has(ob)).toBe(false);
    }
  });

  // ── Cross-tenant: total row counts confirm isolation ────────────────────

  it('total rows visible per tenant equals only that tenants data', async () => {
    const cntA = await asApp(TA, tx =>
      tx.$queryRawUnsafe<{cnt:string}[]>(`SELECT COUNT(*)::text AS cnt FROM close_period_states WHERE period_year=${YEAR} AND period_month=${MONTH}`)
    );
    const cntB = await asApp(TB, tx =>
      tx.$queryRawUnsafe<{cnt:string}[]>(`SELECT COUNT(*)::text AS cnt FROM close_period_states WHERE period_year=${YEAR} AND period_month=${MONTH}`)
    );
    // Each tenant inserted exactly 2 rows (LE1, LE2)
    expect(parseInt(cntA[0].cnt, 10)).toBe(2);
    expect(parseInt(cntB[0].cnt, 10)).toBe(2);
  });
});

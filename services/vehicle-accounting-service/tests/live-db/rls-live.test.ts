/**
 * CE-12 (S074-S077) — Row Level Security pos/neg proof against a real
 * PostgreSQL instance. Mirrors services/tax-service/tests/live-db/
 * rls-isolation.ts and services/posting-recovery-service's equivalent
 * (plain `pg`, not Prisma — SET/set_config/SET ROLE are per-connection, so
 * this needs precise control over which single physical connection each
 * assertion runs on), scoped to this service's own tables, folded into the
 * vitest describe.skipIf(!LIVE_DATABASE_URL) convention coa-service's
 * tests/live-db/*.test.ts use (rather than a separate standalone script)
 * so it runs via the same `npx vitest run` a CI live-db job would invoke.
 *
 * Connection roles used:
 *   LIVE_DATABASE_URL        — migration/superuser connection (bypasses RLS
 *                               unconditionally; used only to seed fixture
 *                               rows directly, never to assert enforcement).
 *   LIVE_APP_DATABASE_URL    — an ordinary (non-superuser) role's connection
 *                               string (e.g. amacc_app), the same role this
 *                               service's Prisma client connects as in a
 *                               real deployment. Defaults to swapping the
 *                               LIVE_DATABASE_URL's user to "amacc_app" if
 *                               not explicitly provided.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import pg from 'pg';

const LIVE_DB_URL = process.env['LIVE_DATABASE_URL'];
const APP_DB_URL = process.env['LIVE_APP_DATABASE_URL'] ?? (LIVE_DB_URL ? LIVE_DB_URL.replace(/:\/\/[^:@/]+(:[^@/]*)?@/, '://amacc_app@') : undefined);

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

describe.skipIf(!LIVE_DB_URL)('Live database — RLS pos/neg (vehicle_unit, dealer_trade, audit_outbox)', () => {
  const tenantA = `veh-rls-a-${randomUUID()}`;
  const tenantB = `veh-rls-b-${randomUUID()}`;
  const unitAId = randomUUID();
  const unitBId = randomUUID();

  beforeAll(async () => {
    await withClient(LIVE_DB_URL!, async (c) => {
      await c.query(
        `INSERT INTO vehicle_unit (id, tenant_id, entity_id, store_id, vin, stock_number, status, acquisition_type, book_value, created_at, updated_at)
         VALUES ($1, $2, 'entity-a', 'store-a', 'VINAAAAAAAAAAAAAA', $3, 'NEW', 'PURCHASE', 25000.00, now(), now())`,
        [unitAId, tenantA, `STK-A-${randomUUID().slice(0, 8)}`],
      );
      await c.query(
        `INSERT INTO vehicle_unit (id, tenant_id, entity_id, store_id, vin, stock_number, status, acquisition_type, book_value, created_at, updated_at)
         VALUES ($1, $2, 'entity-b', 'store-b', 'VINBBBBBBBBBBBBBB', $3, 'NEW', 'PURCHASE', 30000.00, now(), now())`,
        [unitBId, tenantB, `STK-B-${randomUUID().slice(0, 8)}`],
      );
    });
  });

  afterAll(async () => {
    await withClient(LIVE_DB_URL!, async (c) => {
      await c.query(`DELETE FROM vehicle_unit WHERE id IN ($1, $2)`, [unitAId, unitBId]);
    });
  });

  it('tenant A reads its own vehicle_unit row only, not tenant B\'s', async () => {
    await withClient(APP_DB_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
      const res = await c.query(`SELECT id FROM vehicle_unit WHERE id IN ($1, $2)`, [unitAId, unitBId]);
      expect(res.rows.map((r) => r.id)).toEqual([unitAId]);
    });
  });

  it('tenant A cannot UPDATE tenant B\'s vehicle_unit row (0 rows affected)', async () => {
    await withClient(APP_DB_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
      const res = await c.query(`UPDATE vehicle_unit SET status = 'WHOLESALE' WHERE id = $1`, [unitBId]);
      expect(res.rowCount).toBe(0);
    });
  });

  it('tenant A cannot INSERT a dealer_trade row claiming to be tenant B', async () => {
    await withClient(APP_DB_URL!, async (c) => {
      await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
      await expect(
        c.query(
          `INSERT INTO dealer_trade (id, tenant_id, entity_id, store_id, trade_number, direction, counterparty_dealer, agreed_value, status, actor, idempotency_key, created_at, updated_at)
           VALUES ($1, $2, 'entity-injected', 'store-injected', 'TRD-INJECT', 'OUTBOUND', 'Injected Dealer', 100.00, 'OPEN', 'attacker', $3, now(), now())`,
          [randomUUID(), tenantB, randomUUID()],
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  it('missing tenant context sees zero rows (deny-by-default)', async () => {
    await withClient(APP_DB_URL!, async (c) => {
      const res = await c.query(`SELECT count(*)::int AS n FROM vehicle_unit WHERE id IN ($1, $2)`, [unitAId, unitBId]);
      expect(res.rows[0].n).toBe(0);
    });
  });

  it('amacc_rls_bypass role sees both tenants (explicit, auditable bypass)', async () => {
    await withClient(LIVE_DB_URL!, async (c) => {
      await c.query(`SET ROLE amacc_rls_bypass`);
      const res = await c.query(`SELECT count(*)::int AS n FROM vehicle_unit WHERE id IN ($1, $2)`, [unitAId, unitBId]);
      await c.query(`RESET ROLE`);
      expect(res.rows[0].n).toBe(2);
    });
  });

  it('the plain application role cannot invoke the bypass role at all', async () => {
    await withClient(APP_DB_URL!, async (c) => {
      await expect(c.query(`SET ROLE amacc_rls_bypass`)).rejects.toThrow(/permission denied/i);
    });
  });

  it('audit_outbox is excluded from RLS (background AuditOutboxDrainer runs outside tenant context)', async () => {
    await withClient(APP_DB_URL!, async (c) => {
      const res = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'audit_outbox'`);
      expect(res.rows[0]?.relrowsecurity).toBe(false);
    });
  });

  it('every other CE-12 table has FORCE ROW LEVEL SECURITY enabled', async () => {
    await withClient(APP_DB_URL!, async (c) => {
      const res = await c.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
         WHERE relname IN ('vehicle_unit','vehicle_cost_component','vehicle_stock_in_event','vehicle_recon_cost_event',
                            'vehicle_cost_component_event','vehicle_pack_policy_config','demo_reclass',
                            'demo_depreciation_basis_config','demo_value_adjustment','lcnrv_threshold_config',
                            'lcnrv_market_evidence','lcnrv_write_down','dealer_trade','dealer_trade_settlement')`,
      );
      expect(res.rows).toHaveLength(14);
      for (const row of res.rows) {
        expect(row.relrowsecurity, row.relname).toBe(true);
        expect(row.relforcerowsecurity, row.relname).toBe(true);
      }
    });
  });
});

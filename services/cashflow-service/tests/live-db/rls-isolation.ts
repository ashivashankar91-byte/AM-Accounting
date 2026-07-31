/**
 * cashflow-service — real-Postgres RLS isolation proof for the migration
 * added in this fix (20260730000001_add_rls_policies_cashflow_svc).
 * Previously cashflow_forecasts/daily_cash_actuals had no RLS at all,
 * unlike every other tenant-owned table in this codebase.
 *
 * Usage:
 *   1. Fresh Postgres with both cashflow-service migrations applied
 *      (20260730000000_cashflow_baseline, 20260730000001_add_rls_policies_cashflow_svc)
 *   2. PG_SUPERUSER_URL=... PG_APP_URL=... npx tsx services/cashflow-service/tests/live-db/rls-isolation.ts
 */
import pg from 'pg';
import { randomUUID } from 'crypto';

const SUPERUSER_URL = process.env['PG_SUPERUSER_URL'];
const APP_URL = process.env['PG_APP_URL'];

if (!SUPERUSER_URL || !APP_URL) {
  console.error('PG_SUPERUSER_URL and PG_APP_URL must both be set. See file header for usage.');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function pass(label: string) { console.log(`  ✓ ${label}`); passed += 1; }
function fail(label: string, detail: string) { console.error(`  ✗ ${label} — ${detail}`); failed += 1; }

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function main() {
  const tenantA = `cf-rls-test-a-${randomUUID()}`;
  const tenantB = `cf-rls-test-b-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();

  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(
      `INSERT INTO cashflow_forecasts (id, tenant_id, forecast_date, predicted_balance, confidence, breakdown) VALUES ($1, $2, now(), 100.00, 0.9, '{}'::jsonb)`,
      [idA, tenantA],
    );
    await c.query(
      `INSERT INTO cashflow_forecasts (id, tenant_id, forecast_date, predicted_balance, confidence, breakdown) VALUES ($1, $2, now(), 200.00, 0.9, '{}'::jsonb)`,
      [idB, tenantB],
    );
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT id FROM cashflow_forecasts WHERE id IN ($1, $2)`, [idA, idB]);
    const ids = res.rows.map((r) => r.id);
    if (ids.length === 1 && ids[0] === idA) pass('tenant A reads its own cashflow_forecasts row only (not tenant B\'s)');
    else fail('tenant A reads its own row only', `got ${JSON.stringify(ids)}`);
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE cashflow_forecasts SET confidence = 0.1 WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s cashflow_forecasts row');
    else fail('tenant A cannot UPDATE tenant B\'s row', `rowCount=${res.rowCount}`);
  });

  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM cashflow_forecasts WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero cashflow_forecasts rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await c.query(
        `INSERT INTO daily_cash_actuals (id, tenant_id, date, balance) VALUES ($1, $2, now(), 500.00)`,
        [randomUUID(), tenantB],
      );
      fail('tenant A cannot INSERT into daily_cash_actuals claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a daily_cash_actuals row claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });

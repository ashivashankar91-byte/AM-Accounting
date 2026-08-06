/**
 * CE-09 S044 — PostgreSQL Row Level Security isolation proof for the two
 * new trade-payoff tables, against a real Postgres instance. Modeled
 * directly on test-rls-isolation-apar-payment-runs.ts (S043B) — same
 * three-role setup, same plain-`pg` rationale.
 *
 * Prerequisites: tests/integration/rls-live-db/setup.sh (applies
 * apar-service's full migration history, including S044's migrations,
 * via `prisma migrate deploy`).
 *
 * Usage:
 *   PG_SUPERUSER_URL=postgresql://amacc_test@localhost:PORT/DBNAME \
 *   PG_APP_URL=postgresql://amacc_app@localhost:PORT/DBNAME \
 *   PG_ADMIN_URL=postgresql://amacc_admin@localhost:PORT/DBNAME \
 *   npx tsx test-rls-isolation-apar-trade-payoff.ts
 */
import pg from 'pg';
import { randomUUID } from 'crypto';

const SUPERUSER_URL = process.env['PG_SUPERUSER_URL'];
const APP_URL = process.env['PG_APP_URL'];
const ADMIN_URL = process.env['PG_ADMIN_URL'];

if (!SUPERUSER_URL || !APP_URL || !ADMIN_URL) {
  console.error('PG_SUPERUSER_URL, PG_APP_URL and PG_ADMIN_URL must all be set. See file header for usage.');
  process.exit(1);
}

let passed = 0;
let failed = 0;

function pass(label: string) {
  console.log(`  ✓ ${label}`);
  passed += 1;
}

function fail(label: string, detail: string) {
  console.error(`  ✗ ${label} — ${detail}`);
  failed += 1;
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

interface TableSpec {
  table: string;
  insertSql: string;
  updateSql: string;
  hasSeparateId: boolean;
}

async function testTable(spec: TableSpec) {
  const tenantA = `apar-rls-tp-a-${randomUUID()}`;
  const tenantB = `apar-rls-tp-b-${randomUUID()}`;
  const idA = spec.hasSeparateId ? randomUUID() : tenantA;
  const idB = spec.hasSeparateId ? randomUUID() : tenantB;

  console.log(`\n-- ${spec.table} --`);

  await withClient(SUPERUSER_URL!, async (c) => {
    const paramsA = spec.hasSeparateId ? [idA, tenantA] : [tenantA];
    const paramsB = spec.hasSeparateId ? [idB, tenantB] : [tenantB];
    await c.query(spec.insertSql, paramsA);
    await c.query(spec.insertSql, paramsB);
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT tenant_id FROM ${spec.table} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
    const tenants = res.rows.map((r) => r.tenant_id);
    if (tenants.length === 1 && tenants[0] === tenantA) pass(`${spec.table}: tenant A reads its own row only`);
    else fail(`${spec.table}: tenant A reads its own row only`, `got ${JSON.stringify(tenants)}`);
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(spec.updateSql, [idB]);
    if (res.rowCount === 0) pass(`${spec.table}: tenant A cannot UPDATE tenant B's row (0 rows affected)`);
    else fail(`${spec.table}: tenant A cannot UPDATE tenant B's row`, `rowCount=${res.rowCount}`);
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`DELETE FROM ${spec.table} WHERE tenant_id = $1 AND tenant_id != current_setting('app.current_tenant_id', true)`, [tenantB]);
    if (res.rowCount === 0) pass(`${spec.table}: tenant A cannot DELETE tenant B's row (0 rows affected)`);
    else fail(`${spec.table}: tenant A cannot DELETE tenant B's row`, `rowCount=${res.rowCount}`);
  });

  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM ${spec.table} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
    if (res.rows[0].n === 0) pass(`${spec.table}: missing tenant context sees zero rows (deny-by-default)`);
    else fail(`${spec.table}: missing tenant context sees zero rows`, `got n=${res.rows[0].n}`);
  });

  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM ${spec.table} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
    await c.query(`RESET ROLE`);
    if (res.rows[0].n === 2) pass(`${spec.table}: admin explicitly invoking amacc_rls_bypass sees both tenants`);
    else fail(`${spec.table}: explicit bypass sees both tenants`, `got n=${res.rows[0].n}`);
  });

  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`DELETE FROM ${spec.table} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
  });
}

async function main() {
  await testTable({
    table: 'ap_trade_payoff_payments',
    insertSql: `INSERT INTO ap_trade_payoff_payments (id, tenant_id, deal_reference, payee_name, payee_remit_address, amount, good_through_date, bank_account_id, created_by)
                VALUES ($1, $2, 'deal-rls-test', 'RLS Test Lienholder', '1 Main St', 15000.00, '2027-01-01', 'bank-rls-test', 'rls-test-user')`,
    updateSql: `UPDATE ap_trade_payoff_payments SET status = 'VOID' WHERE id = $1`,
    hasSeparateId: true,
  });

  await testTable({
    table: 'ap_trade_payoff_gl_account_configs',
    insertSql: `INSERT INTO ap_trade_payoff_gl_account_configs (tenant_id, updated_at) VALUES ($1, now())`,
    updateSql: `UPDATE ap_trade_payoff_gl_account_configs SET payoff_clearing_gl_account_id = 'x' WHERE tenant_id = $1`,
    hasSeparateId: false,
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

/**
 * CE-09 S043B — PostgreSQL Row Level Security isolation proof for the
 * three new AP payment-run tables, against a real Postgres instance.
 * Modeled directly on test-rls-isolation-apar-wholesale-vehicle.ts (S048)
 * — same three-role setup, same plain-`pg` rationale, same CTE-based
 * insert technique for child tables that carry a real FK to the parent
 * run row.
 *
 * Prerequisites: tests/integration/rls-live-db/setup.sh (applies
 * apar-service's full migration history, including S043B's migrations,
 * via `prisma migrate deploy`).
 *
 * Usage:
 *   PG_SUPERUSER_URL=postgresql://amacc_test@localhost:PORT/DBNAME \
 *   PG_APP_URL=postgresql://amacc_app@localhost:PORT/DBNAME \
 *   PG_ADMIN_URL=postgresql://amacc_admin@localhost:PORT/DBNAME \
 *   npx tsx test-rls-isolation-apar-payment-runs.ts
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
  insertParams: (id: string, tenant: string) => string[];
  updateSql: string;
}

async function testTable(spec: TableSpec) {
  const tenantA = `apar-rls-pr-a-${randomUUID()}`;
  const tenantB = `apar-rls-pr-b-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();

  console.log(`\n-- ${spec.table} --`);

  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(spec.insertSql, spec.insertParams(idA, tenantA));
    await c.query(spec.insertSql, spec.insertParams(idB, tenantB));
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
    await c.query(`DELETE FROM ap_payment_run_rail_artifacts WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
    await c.query(`DELETE FROM ap_payment_run_items WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
    await c.query(`DELETE FROM ap_payment_runs WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
  });
}

async function main() {
  await testTable({
    table: 'ap_payment_runs',
    insertSql: `INSERT INTO ap_payment_runs (id, tenant_id, bank_account_id, due_date_through, cash_requirement_total, proposed_by)
                VALUES ($1, $2, 'bank-rls-test', '2026-08-15', 500.00, 'rls-test-user')`,
    insertParams: (id, tenant) => [id, tenant],
    updateSql: `UPDATE ap_payment_runs SET status = 'REJECTED' WHERE id = $1`,
  });

  await testTable({
    table: 'ap_payment_run_items',
    insertSql: `WITH run AS (
                  INSERT INTO ap_payment_runs (id, tenant_id, bank_account_id, due_date_through, cash_requirement_total, proposed_by)
                  VALUES ($3, $2, 'bank-rls-test', '2026-08-15', 500.00, 'rls-test-user')
                  RETURNING id
                )
                INSERT INTO ap_payment_run_items (id, tenant_id, run_id, invoice_id, vendor_id, amount)
                SELECT $1, $2, run.id, 'invoice-rls-test', 'vendor-rls-test', 500.00 FROM run`,
    insertParams: (id, tenant) => [id, tenant, randomUUID()],
    updateSql: `UPDATE ap_payment_run_items SET status = 'FAILED' WHERE id = $1`,
  });

  await testTable({
    table: 'ap_payment_run_rail_artifacts',
    insertSql: `WITH run AS (
                  INSERT INTO ap_payment_runs (id, tenant_id, bank_account_id, due_date_through, cash_requirement_total, proposed_by, status)
                  VALUES ($3, $2, 'bank-rls-test', '2026-08-15', 500.00, 'rls-test-user', 'EXECUTED')
                  RETURNING id
                )
                INSERT INTO ap_payment_run_rail_artifacts (id, tenant_id, run_id, mode, status, file_content, total_amount, item_count)
                SELECT $1, $2, run.id, 'CHECK_PRINT', 'GENERATED', 'CHECK_NUMBER,VENDOR_ID,AMOUNT', 500.00, 1 FROM run`,
    insertParams: (id, tenant) => [id, tenant, randomUUID()],
    updateSql: `UPDATE ap_payment_run_rail_artifacts SET status = 'PAYMENT_RAIL_NOT_CONFIGURED' WHERE id = $1`,
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

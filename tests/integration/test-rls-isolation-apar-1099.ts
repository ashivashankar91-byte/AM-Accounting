/**
 * CE-09 S037 — PostgreSQL Row Level Security isolation proof for the
 * three new 1099/T4A tables, against a real Postgres instance. Modeled
 * directly on test-rls-isolation-apar-fleet-billing.ts (S047) — same
 * three-role setup, same plain-`pg` rationale.
 *
 * Prerequisites: tests/integration/rls-live-db/setup.sh (applies
 * apar-service's full migration history, including S037's migrations,
 * via `prisma migrate deploy`).
 *
 * Usage:
 *   PG_SUPERUSER_URL=postgresql://amacc_test@localhost:PORT/DBNAME \
 *   PG_APP_URL=postgresql://amacc_app@localhost:PORT/DBNAME \
 *   PG_ADMIN_URL=postgresql://amacc_admin@localhost:PORT/DBNAME \
 *   npx tsx test-rls-isolation-apar-1099.ts
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
  updateParam?: (idB: string, tenantB: string) => string;
  cleanupTables: string[];
}

async function testTable(spec: TableSpec) {
  const tenantA = `apar-rls-1099-a-${randomUUID()}`;
  const tenantB = `apar-rls-1099-b-${randomUUID()}`;
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
    const updateParamValue = spec.updateParam ? spec.updateParam(idB, tenantB) : idB;
    const res = await c.query(spec.updateSql, [updateParamValue]);
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
    for (const t of spec.cleanupTables) {
      await c.query(`DELETE FROM ${t} WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
    }
  });
}

async function main() {
  await testTable({
    table: 'ap_1099_vendor_box_rules',
    insertSql: `INSERT INTO ap_1099_vendor_box_rules (id, tenant_id, vendor_id, tax_year, form_type, box_code, created_by)
                VALUES ($1, $2, $3, 2026, '1099-NEC', '1', 'rls-test-user')`,
    insertParams: (id, tenant) => [id, tenant, randomUUID()],
    updateSql: `UPDATE ap_1099_vendor_box_rules SET box_code = '7' WHERE id = $1`,
    cleanupTables: ['ap_1099_vendor_box_rules'],
  });

  await testTable({
    table: 'ap_1099_threshold_configs',
    insertSql: `INSERT INTO ap_1099_threshold_configs (id, tenant_id, form_type, tax_year, threshold_amount)
                VALUES ($1, $2, '1099-NEC', 2026, 600.00)`,
    insertParams: (id, tenant) => [id, tenant],
    updateSql: `UPDATE ap_1099_threshold_configs SET threshold_amount = 700.00 WHERE id = $1`,
    cleanupTables: ['ap_1099_threshold_configs'],
  });

  await testTable({
    table: 'ap_1099_corrections',
    insertSql: `INSERT INTO ap_1099_corrections (id, tenant_id, vendor_id, tax_year, form_type, original_amount, corrected_amount, reason, created_by)
                VALUES ($1, $2, $3, 2026, '1099-NEC', 400.00, 700.00, 'rls test', 'rls-test-user')`,
    insertParams: (id, tenant) => [id, tenant, randomUUID()],
    updateSql: `UPDATE ap_1099_corrections SET reason = 'changed' WHERE id = $1`,
    cleanupTables: ['ap_1099_corrections'],
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

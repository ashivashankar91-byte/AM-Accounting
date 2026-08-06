/**
 * S046 — PostgreSQL Row Level Security isolation proof for the `customers`
 * table, against a real Postgres instance. Modeled directly on
 * test-rls-isolation-apar-vendor.ts (AMACC-CH04 S036A) — same three-role
 * setup, same plain-`pg` rationale (see that file's header comment for why
 * raw `pg` is used instead of Prisma).
 *
 * Prerequisites: tests/integration/rls-live-db/setup.sh (apar-service's
 * migration history — now including the S046 hardening + RLS migrations —
 * is applied automatically via `prisma migrate deploy`).
 *
 * Usage:
 *   PG_SUPERUSER_URL=postgresql://amacc_test@localhost:PORT/DBNAME \
 *   PG_APP_URL=postgresql://amacc_app@localhost:PORT/DBNAME \
 *   PG_ADMIN_URL=postgresql://amacc_admin@localhost:PORT/DBNAME \
 *   npx tsx test-rls-isolation-apar-customer.ts
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

async function main() {
  const tenantA = `apar-rls-cust-a-${randomUUID()}`;
  const tenantB = `apar-rls-cust-b-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();

  await withClient(SUPERUSER_URL!, async (c) => {
    for (const [id, tenant, name] of [[idA, tenantA, 'RLS Customer A'], [idB, tenantB, 'RLS Customer B']] as const) {
      await c.query(
        `INSERT INTO customers (id, tenant_id, customer_number, normalized_customer_number, customer_name, normalized_customer_name, status, is_active, version, credit_hold)
         VALUES ($1, $2, '999999', '999999', $3, lower($3), 'ACTIVE', true, 1, false)`,
        [id, tenant, name],
      );
    }
  });

  // ── Test 1: tenant A can read its own row, not tenant B's ──────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT customer_name FROM customers WHERE id IN ($1, $2)`, [idA, idB]);
    const names = res.rows.map((r) => r.customer_name);
    if (names.length === 1 && names[0] === 'RLS Customer A') pass('tenant A reads its own customer only (not tenant B\'s)');
    else fail('tenant A reads its own customer only', `got ${JSON.stringify(names)}`);
  });

  // ── Test 2: tenant A cannot UPDATE tenant B's customer ──────────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE customers SET customer_name = 'HACKED' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s customer (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s customer', `rowCount=${res.rowCount}`);
  });

  // ── Test 3: tenant A cannot place a credit hold on tenant B's customer ─────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE customers SET credit_hold = true, credit_hold_reason = 'HACKED HOLD' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot place a credit hold on tenant B\'s customer (0 rows affected)');
    else fail('tenant A cannot place a credit hold on tenant B\'s customer', `rowCount=${res.rowCount}`);
  });

  // ── Test 4: tenant A cannot DELETE tenant B's customer ──────────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`DELETE FROM customers WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot DELETE tenant B\'s customer (0 rows affected)');
    else fail('tenant A cannot DELETE tenant B\'s customer', `rowCount=${res.rowCount}`);
  });
  await withClient(SUPERUSER_URL!, async (c) => {
    const res = await c.query(`SELECT customer_name, credit_hold FROM customers WHERE id = $1`, [idB]);
    if (res.rows[0]?.customer_name === 'RLS Customer B' && res.rows[0]?.credit_hold === false) {
      pass('tenant B\'s customer is genuinely untouched (verified via superuser)');
    } else {
      fail('tenant B\'s customer is genuinely untouched', `got ${JSON.stringify(res.rows[0])}`);
    }
  });

  // ── Test 5: a query's own WHERE tenant_id = <other tenant> cannot bypass RLS ──
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT customer_name FROM customers WHERE tenant_id = $1`, [tenantB]);
    if (res.rows.length === 0) pass('an explicit WHERE tenant_id = <other tenant> in the query itself cannot bypass RLS');
    else fail('WHERE tenant_id override cannot bypass RLS', `got ${JSON.stringify(res.rows)}`);
  });

  // ── Test 6: tenant A cannot INSERT a row claiming to be tenant B ────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await c.query(
        `INSERT INTO customers (id, tenant_id, customer_number, normalized_customer_number, customer_name, normalized_customer_name, status, is_active, version, credit_hold)
         VALUES ($1, $2, '000002', '000002', 'Injected', 'injected', 'ACTIVE', true, 1, false)`,
        [randomUUID(), tenantB],
      );
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a customer claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 7: missing tenant context is denied (sees nothing) ────────────────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM customers WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero customer rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  // ── Test 8: admin WITHOUT invoking the bypass role is still constrained ────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM customers WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 1) pass('admin role without explicit bypass is still constrained to its own tenant context');
    else fail('admin without bypass is constrained', `got n=${res.rows[0].n}`);
  });

  // ── Test 9: admin explicitly invoking the bypass role sees both tenants ────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM customers WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`RESET ROLE`);
    if (res.rows[0].n === 2) pass('admin explicitly invoking amacc_rls_bypass sees both tenants\' customers');
    else fail('explicit bypass sees both tenants', `got n=${res.rows[0].n}`);
  });

  // ── Test 10: the per-tenant customer-number counter table is also isolated ─
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(
      `INSERT INTO ar_customer_number_counters (tenant_id, next_number) VALUES ($1, 5), ($2, 9)
       ON CONFLICT (tenant_id) DO UPDATE SET next_number = EXCLUDED.next_number`,
      [tenantA, tenantB],
    );
  });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT next_number FROM ar_customer_number_counters WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
    if (res.rows.length === 1 && res.rows[0].next_number === 5) pass('customer-number counter table is tenant-isolated');
    else fail('customer-number counter table is tenant-isolated', `got ${JSON.stringify(res.rows)}`);
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`DELETE FROM customers WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`DELETE FROM ar_customer_number_counters WHERE tenant_id IN ($1, $2)`, [tenantA, tenantB]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

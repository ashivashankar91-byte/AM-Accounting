/**
 * AMACC-CH04 S036B — PostgreSQL Row Level Security isolation proof for the
 * `vendor_compliance_checks` table, against a real Postgres instance.
 * Modeled directly on test-rls-isolation-apar-vendor.ts (S036A) — same
 * three-role setup, same plain-`pg` rationale.
 *
 * Prerequisites: tests/integration/rls-live-db/setup.sh (applies
 * apar-service's full migration history, including S036B's two new
 * migrations, via `prisma migrate deploy`).
 *
 * Usage:
 *   PG_SUPERUSER_URL=postgresql://amacc_test@localhost:PORT/DBNAME \
 *   PG_APP_URL=postgresql://amacc_app@localhost:PORT/DBNAME \
 *   PG_ADMIN_URL=postgresql://amacc_admin@localhost:PORT/DBNAME \
 *   npx tsx test-rls-isolation-apar-vendor-compliance.ts
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
  const tenantA = `apar-rls-cc-a-${randomUUID()}`;
  const tenantB = `apar-rls-cc-b-${randomUUID()}`;
  const vendorId = randomUUID();
  const idA = randomUUID();
  const idB = randomUUID();

  await withClient(SUPERUSER_URL!, async (c) => {
    // Vendor row is only needed so the app-layer FK-less vendorId lookup has
    // something real to point at; RLS on vendor_compliance_checks does not
    // depend on the vendors row's own tenant at the DB level (the join lives
    // in the application layer, not a DB constraint).
    await c.query(
      `INSERT INTO vendors (id, tenant_id, vendor_number, normalized_vendor_number, vendor_name, normalized_vendor_name, status, is_active, version)
       VALUES ($1, $2, '999998', '999998', 'RLS Compliance Vendor', 'rls compliance vendor', 'ACTIVE', true, 1)
       ON CONFLICT DO NOTHING`,
      [vendorId, tenantA],
    );
    for (const [id, tenant] of [[idA, tenantA], [idB, tenantB]] as const) {
      await c.query(
        `INSERT INTO vendor_compliance_checks (id, tenant_id, vendor_id, check_type, status, version)
         VALUES ($1, $2, $3, 'INSURANCE_CERTIFICATE', 'PENDING_REVIEW', 1)`,
        [id, tenant, vendorId],
      );
    }
  });

  // ── Test 1: tenant A can read its own row, not tenant B's ──────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT id FROM vendor_compliance_checks WHERE id IN ($1, $2)`, [idA, idB]);
    const ids = res.rows.map((r) => r.id);
    if (ids.length === 1 && ids[0] === idA) pass('tenant A reads its own compliance check only (not tenant B\'s)');
    else fail('tenant A reads its own compliance check only', `got ${JSON.stringify(ids)}`);
  });

  // ── Test 2: tenant A cannot UPDATE tenant B's compliance check ─────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE vendor_compliance_checks SET status = 'VERIFIED' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s compliance check (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s compliance check', `rowCount=${res.rowCount}`);
  });

  // ── Test 3: tenant A cannot DELETE tenant B's compliance check ─────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`DELETE FROM vendor_compliance_checks WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot DELETE tenant B\'s compliance check (0 rows affected)');
    else fail('tenant A cannot DELETE tenant B\'s compliance check', `rowCount=${res.rowCount}`);
  });
  await withClient(SUPERUSER_URL!, async (c) => {
    const res = await c.query(`SELECT status FROM vendor_compliance_checks WHERE id = $1`, [idB]);
    if (res.rows[0]?.status === 'PENDING_REVIEW') pass('tenant B\'s compliance check is genuinely untouched (verified via superuser)');
    else fail('tenant B\'s compliance check is genuinely untouched', `got ${JSON.stringify(res.rows[0])}`);
  });

  // ── Test 4: an explicit WHERE tenant_id = <other tenant> cannot bypass RLS ─
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT id FROM vendor_compliance_checks WHERE tenant_id = $1`, [tenantB]);
    if (res.rows.length === 0) pass('an explicit WHERE tenant_id = <other tenant> in the query itself cannot bypass RLS');
    else fail('WHERE tenant_id override cannot bypass RLS', `got ${JSON.stringify(res.rows)}`);
  });

  // ── Test 5: tenant A cannot INSERT a row claiming to be tenant B ───────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await c.query(
        `INSERT INTO vendor_compliance_checks (id, tenant_id, vendor_id, check_type, status, version)
         VALUES ($1, $2, $3, 'OTHER', 'PENDING_REVIEW', 1)`,
        [randomUUID(), tenantB, vendorId],
      );
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a compliance check claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 6: missing tenant context is denied (sees nothing) ────────────────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM vendor_compliance_checks WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero compliance-check rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  // ── Test 7: admin WITHOUT invoking the bypass role is still constrained ────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM vendor_compliance_checks WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 1) pass('admin role without explicit bypass is still constrained to its own tenant context');
    else fail('admin without bypass is constrained', `got n=${res.rows[0].n}`);
  });

  // ── Test 8: admin explicitly invoking the bypass role sees both tenants ────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM vendor_compliance_checks WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`RESET ROLE`);
    if (res.rows[0].n === 2) pass('admin explicitly invoking amacc_rls_bypass sees both tenants\' compliance checks');
    else fail('explicit bypass sees both tenants', `got n=${res.rows[0].n}`);
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`DELETE FROM vendor_compliance_checks WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`DELETE FROM vendors WHERE id = $1`, [vendorId]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

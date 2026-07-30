/**
 * AMACC-CH04 S038 — PostgreSQL Row Level Security isolation proof for the
 * `vendor_insurance_certificates` table, against a real Postgres instance.
 * Modeled directly on test-rls-isolation-apar-vendor.ts (S036A) — see that
 * file's header comment for the plain-`pg` rationale.
 *
 * Prerequisites: tests/integration/rls-live-db/setup.sh (apar-service's
 * migration history now includes 20260730000000_s038_vendor_insurance_
 * certificates, applied automatically by the existing bootstrap step).
 *
 * Usage:
 *   PG_SUPERUSER_URL=postgresql://amacc_test@localhost:PORT/DBNAME \
 *   PG_APP_URL=postgresql://amacc_app@localhost:PORT/DBNAME \
 *   PG_ADMIN_URL=postgresql://amacc_admin@localhost:PORT/DBNAME \
 *   npx tsx test-rls-isolation-apar-vendor-insurance.ts
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
  const tenantA = `apar-rls-ic-a-${randomUUID()}`;
  const tenantB = `apar-rls-ic-b-${randomUUID()}`;
  const vendorA = randomUUID();
  const vendorB = randomUUID();
  const idA = randomUUID();
  const idB = randomUUID();

  await withClient(SUPERUSER_URL!, async (c) => {
    // Parent vendors so the certificate rows have a real owning vendor per
    // tenant (mirrors production: application layer always re-checks vendor
    // ownership, but RLS itself is what this test proves).
    for (const [id, tenant, name] of [[vendorA, tenantA, 'RLS IC Vendor A'], [vendorB, tenantB, 'RLS IC Vendor B']] as const) {
      await c.query(
        `INSERT INTO vendors (id, tenant_id, vendor_number, normalized_vendor_number, vendor_name, normalized_vendor_name, status, is_active, version)
         VALUES ($1, $2, '999998', '999998', $3, lower($3), 'ACTIVE', true, 1)`,
        [id, tenant, name],
      );
    }
    for (const [id, tenant, vendorId, name] of [
      [idA, tenantA, vendorA, 'RLS Cert A'],
      [idB, tenantB, vendorB, 'RLS Cert B'],
    ] as const) {
      await c.query(
        `INSERT INTO vendor_insurance_certificates
           (id, tenant_id, vendor_id, certificate_number, insurance_provider, insurance_type, effective_date, expiration_date, status, is_current, version, updated_at)
         VALUES ($1, $2, $3, '999998', $4, 'GENERAL_LIABILITY', now(), now() + interval '1 year', 'ACTIVE', true, 1, now())`,
        [id, tenant, vendorId, name],
      );
    }
  });

  // ── Test 1: tenant A can read its own row, not tenant B's ──────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT insurance_provider FROM vendor_insurance_certificates WHERE id IN ($1, $2)`, [idA, idB]);
    const names = res.rows.map((r) => r.insurance_provider);
    if (names.length === 1 && names[0] === 'RLS Cert A') pass('tenant A reads its own certificate only (not tenant B\'s)');
    else fail('tenant A reads its own certificate only', `got ${JSON.stringify(names)}`);
  });

  // ── Test 2: tenant A cannot UPDATE tenant B's certificate ───────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE vendor_insurance_certificates SET insurance_provider = 'HACKED' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s certificate (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s certificate', `rowCount=${res.rowCount}`);
  });

  // ── Test 3: tenant A cannot DELETE tenant B's certificate ───────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`DELETE FROM vendor_insurance_certificates WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot DELETE tenant B\'s certificate (0 rows affected)');
    else fail('tenant A cannot DELETE tenant B\'s certificate', `rowCount=${res.rowCount}`);
  });
  await withClient(SUPERUSER_URL!, async (c) => {
    const res = await c.query(`SELECT insurance_provider FROM vendor_insurance_certificates WHERE id = $1`, [idB]);
    if (res.rows[0]?.insurance_provider === 'RLS Cert B') pass('tenant B\'s certificate is genuinely untouched (verified via superuser)');
    else fail('tenant B\'s certificate is genuinely untouched', `got ${JSON.stringify(res.rows[0])}`);
  });

  // ── Test 4: an explicit WHERE tenant_id = <other tenant> cannot bypass RLS ──
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT insurance_provider FROM vendor_insurance_certificates WHERE tenant_id = $1`, [tenantB]);
    if (res.rows.length === 0) pass('an explicit WHERE tenant_id = <other tenant> in the query itself cannot bypass RLS');
    else fail('WHERE tenant_id override cannot bypass RLS', `got ${JSON.stringify(res.rows)}`);
  });

  // ── Test 5: tenant A cannot INSERT a certificate claiming to be tenant B ────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await c.query(
        `INSERT INTO vendor_insurance_certificates
           (id, tenant_id, vendor_id, certificate_number, insurance_provider, insurance_type, effective_date, expiration_date, status, is_current, version, updated_at)
         VALUES ($1, $2, $3, '000002', 'Injected', 'GENERAL_LIABILITY', now(), now() + interval '1 year', 'ACTIVE', true, 1, now())`,
        [randomUUID(), tenantB, vendorB],
      );
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a certificate claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 6: missing tenant context is denied (sees nothing) ────────────────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM vendor_insurance_certificates WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero certificate rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  // ── Test 7: admin WITHOUT invoking the bypass role is still constrained ────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM vendor_insurance_certificates WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 1) pass('admin role without explicit bypass is still constrained to its own tenant context');
    else fail('admin without bypass is constrained', `got n=${res.rows[0].n}`);
  });

  // ── Test 8: admin explicitly invoking the bypass role sees both tenants ────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM vendor_insurance_certificates WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`RESET ROLE`);
    if (res.rows[0].n === 2) pass('admin explicitly invoking amacc_rls_bypass sees both tenants\' certificates');
    else fail('explicit bypass sees both tenants', `got n=${res.rows[0].n}`);
  });

  // ── Test 9: the partial unique index blocks a second "current" certificate ──
  // (same tenant/vendor/insuranceType — proves duplicate-active protection at
  // the DB layer, independent of the service-layer check.)
  await withClient(SUPERUSER_URL!, async (c) => {
    try {
      await c.query(
        `INSERT INTO vendor_insurance_certificates
           (id, tenant_id, vendor_id, certificate_number, insurance_provider, insurance_type, effective_date, expiration_date, status, is_current, version, updated_at)
         VALUES ($1, $2, $3, '999999', 'Duplicate Attempt', 'GENERAL_LIABILITY', now(), now() + interval '1 year', 'ACTIVE', true, 1, now())`,
        [randomUUID(), tenantA, vendorA],
      );
      fail('DB rejects a second current certificate for the same vendor+type', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/duplicate key value violates unique constraint/i.test(err.message)) {
        pass('DB rejects a second is_current=true certificate for the same (tenant, vendor, insurance_type)');
      } else {
        fail('DB rejects a second current certificate for the same vendor+type', `unexpected error: ${err.message}`);
      }
    }
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`DELETE FROM vendor_insurance_certificates WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`DELETE FROM vendors WHERE id IN ($1, $2)`, [vendorA, vendorB]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

/**
 * R0 Stabilization Phase 5/6 (ADR-001) — PostgreSQL Row Level Security
 * isolation proof, against a real Postgres instance.
 *
 * Deliberately plain `pg` (not Prisma): `SET`/`set_config`/`SET ROLE` are
 * per-connection, and this test needs precise control over which single
 * physical connection each assertion runs on — a `pg.Client` holds exactly
 * one connection for its whole lifetime, sidestepping the pool-affinity
 * hazard a Prisma-pooled client would introduce (see
 * services/coa-service/tests/live-db/posting-live.test.ts's header comment
 * for the concrete case where that hazard mattered).
 *
 * Prerequisites:
 *   - A disposable Postgres instance with the combined AMACC schema +
 *     R0 Stabilization RLS migrations applied (see
 *     docs/accounting-modernization/stabilization/LIVE_DATABASE_TEST_REPORT.md
 *     for the exact provisioning steps — an ephemeral `initdb` instance,
 *     never the shared `amacc` dev database).
 *   - Three roles created by those migrations/this test's setup:
 *       amacc_app   — plain login, no BYPASSRLS (the constrained app role)
 *       amacc_admin — plain login, granted membership in amacc_rls_bypass
 *       amacc_rls_bypass — NOLOGIN, BYPASSRLS (created by the RLS migrations)
 *
 * Usage:
 *   PG_SUPERUSER_URL=postgresql://amacc_test@localhost:PORT/DBNAME \
 *   PG_APP_URL=postgresql://amacc_app@localhost:PORT/DBNAME \
 *   PG_ADMIN_URL=postgresql://amacc_admin@localhost:PORT/DBNAME \
 *   npx tsx test-rls-isolation.ts
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
  const tenantA = `rls-test-a-${randomUUID()}`;
  const tenantB = `rls-test-b-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();

  // ── Setup: seed one row per tenant as the superuser (bypasses RLS naturally) ──
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(
      `INSERT INTO legal_entities (id, tenant_id, entity_code, legal_name, functional_currency, country, fiscal_year_end_month, status, effective_date, version, has_posted_journals, created_at, updated_at)
       VALUES ($1, $2, 'RLSA', 'RLS Test A', 'USD', 'US', 12, 'ACTIVE', '2025-01-01', 1, false, now(), now())`,
      [idA, tenantA],
    );
    await c.query(
      `INSERT INTO legal_entities (id, tenant_id, entity_code, legal_name, functional_currency, country, fiscal_year_end_month, status, effective_date, version, has_posted_journals, created_at, updated_at)
       VALUES ($1, $2, 'RLSB', 'RLS Test B', 'USD', 'US', 12, 'ACTIVE', '2025-01-01', 1, false, now(), now())`,
      [idB, tenantB],
    );
  });

  // ── Test 1: tenant A can read its own row, not tenant B's ──────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT entity_code FROM legal_entities WHERE id IN ($1, $2)`, [idA, idB]);
    const codes = res.rows.map((r) => r.entity_code);
    if (codes.length === 1 && codes[0] === 'RLSA') pass('tenant A reads its own row only (not tenant B\'s)');
    else fail('tenant A reads its own row only', `got ${JSON.stringify(codes)}`);
  });

  // ── Test 2: tenant A cannot UPDATE tenant B's row ──────────────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE legal_entities SET legal_name = 'HACKED' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s row (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s row', `rowCount=${res.rowCount}`);
  });

  // ── Test 3: tenant A cannot DELETE tenant B's row ──────────────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`DELETE FROM legal_entities WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot DELETE tenant B\'s row (0 rows affected)');
    else fail('tenant A cannot DELETE tenant B\'s row', `rowCount=${res.rowCount}`);
  });
  await withClient(SUPERUSER_URL!, async (c) => {
    const res = await c.query(`SELECT legal_name FROM legal_entities WHERE id = $1`, [idB]);
    if (res.rows[0]?.legal_name === 'RLS Test B') pass('tenant B\'s row is genuinely untouched (verified via superuser)');
    else fail('tenant B\'s row is genuinely untouched', `got ${JSON.stringify(res.rows[0])}`);
  });

  // ── Test 4: tenant A cannot INSERT a row claiming to be tenant B ──────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await c.query(
        `INSERT INTO legal_entities (id, tenant_id, entity_code, legal_name, functional_currency, country, fiscal_year_end_month, status, effective_date, version, has_posted_journals, created_at, updated_at)
         VALUES ($1, $2, 'FAKE', 'Injected', 'USD', 'US', 12, 'ACTIVE', '2025-01-01', 1, false, now(), now())`,
        [randomUUID(), tenantB],
      );
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a row claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 5: missing tenant context is denied (sees nothing) ───────────────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM legal_entities WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  // ── Test 6: admin WITHOUT invoking the bypass role is still constrained ───
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM legal_entities WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 1) pass('admin role without explicit bypass is still constrained to its own tenant context (no implicit bypass)');
    else fail('admin without bypass is constrained', `got n=${res.rows[0].n}`);
  });

  // ── Test 7: admin explicitly invoking the bypass role sees both tenants ──
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM legal_entities WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`RESET ROLE`);
    if (res.rows[0].n === 2) pass('admin explicitly invoking amacc_rls_bypass sees both tenants (explicit, auditable bypass works)');
    else fail('explicit bypass sees both tenants', `got n=${res.rows[0].n}`);
  });

  // ── Test 8: the plain application role CANNOT invoke the bypass at all ───
  await withClient(APP_URL!, async (c) => {
    try {
      await c.query(`SET ROLE amacc_rls_bypass`);
      fail('plain app role cannot invoke the bypass role', 'SET ROLE unexpectedly succeeded');
    } catch (err: any) {
      if (/permission denied/i.test(err.message)) pass('plain application role cannot invoke the bypass role at all (constrained, not universally available)');
      else fail('plain app role cannot invoke bypass', `unexpected error: ${err.message}`);
    }
  });

  // ── Cleanup ─────────────────────────────────────────────────────────────
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`DELETE FROM legal_entities WHERE id IN ($1, $2)`, [idA, idB]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

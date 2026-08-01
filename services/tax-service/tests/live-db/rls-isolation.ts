/**
 * S124/S125 Tax Service — PostgreSQL Row Level Security isolation proof,
 * against a real Postgres instance. Mirrors
 * services/posting-recovery-service/tests/live-db/rls-isolation.ts (plain
 * `pg`, not Prisma — SET/set_config/SET ROLE are per-connection, so this
 * needs precise control over which single physical connection each
 * assertion runs on), scoped to this service's own tables.
 *
 * Usage:
 *   services/tax-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... PG_APP_URL=... PG_ADMIN_URL=... \
 *     npx tsx services/tax-service/tests/live-db/rls-isolation.ts
 *   services/tax-service/tests/live-db/teardown.sh
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
  const tenantA = `tax-rls-test-a-${randomUUID()}`;
  const tenantB = `tax-rls-test-b-${randomUUID()}`;
  const entityA1 = `entity-a1-${randomUUID()}`;
  const entityA2 = `entity-a2-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();

  async function insertJurisdiction(c: pg.Client, id: string, tenantId: string, legalEntityId: string, ref: string) {
    await c.query(
      `INSERT INTO jurisdiction_registration
        (id, tenant_id, legal_entity_id, jurisdiction_ref, effective_from, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, '2025-01-01', 'test', now(), now())`,
      [id, tenantId, legalEntityId, ref],
    );
  }

  // ── Setup: seed one row per tenant as the superuser (bypasses RLS) ────────
  await withClient(SUPERUSER_URL!, async (c) => {
    await insertJurisdiction(c, idA, tenantA, entityA1, 'STATE-A');
    await insertJurisdiction(c, idB, tenantB, 'entity-b1', 'STATE-B');
  });

  // ── Test 1: tenant A can read its own row, not tenant B's ────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT jurisdiction_ref FROM jurisdiction_registration WHERE id IN ($1, $2)`, [idA, idB]);
    const refs = res.rows.map((r) => r.jurisdiction_ref);
    if (refs.length === 1 && refs[0] === 'STATE-A') pass('tenant A reads its own jurisdiction_registration row only (not tenant B\'s)');
    else fail('tenant A reads its own row only', `got ${JSON.stringify(refs)}`);
  });

  // ── Test 2: tenant A cannot UPDATE tenant B's row ─────────────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE jurisdiction_registration SET jurisdiction_level = 'hacked' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s jurisdiction_registration row (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s row', `rowCount=${res.rowCount}`);
  });

  // ── Test 3: tenant A cannot INSERT a row claiming to be tenant B ──────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await insertJurisdiction(c, randomUUID(), tenantB, 'entity-injected', 'STATE-INJECTED');
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a jurisdiction_registration row claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 4: missing tenant context sees zero rows (deny-by-default) ──────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM jurisdiction_registration WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero jurisdiction_registration rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  // ── Test 5: RLS is tenant_id-keyed only — same-tenant, DIFFERENT legal
  // entity rows are still VISIBLE at the DB layer (cross-entity scoping is
  // an application-layer concern per src/domain/legal-entity-scope.ts, not
  // an RLS policy) ────────────────────────────────────────────────────────
  const idA2 = randomUUID();
  await withClient(SUPERUSER_URL!, async (c) => {
    await insertJurisdiction(c, idA2, tenantA, entityA2, 'STATE-A2');
  });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM jurisdiction_registration WHERE id IN ($1, $2)`, [idA, idA2]);
    if (res.rows[0].n === 2) pass('RLS alone does not exclude a different legal entity within the same tenant (confirms app-layer must scope legalEntityId — see cross-entity-denial.ts)');
    else fail('RLS is tenant-scoped only', `got n=${res.rows[0].n}`);
  });

  // ── Test 6: admin without explicit bypass is still constrained ──────────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM jurisdiction_registration WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 1) pass('admin role without explicit bypass is still constrained to its own tenant context');
    else fail('admin without bypass is constrained', `got n=${res.rows[0].n}`);
  });

  // ── Test 7: admin explicitly invoking the bypass role sees both tenants ─
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM jurisdiction_registration WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`RESET ROLE`);
    if (res.rows[0].n === 2) pass('admin explicitly invoking amacc_rls_bypass sees both tenants (explicit, auditable bypass works)');
    else fail('explicit bypass sees both tenants', `got n=${res.rows[0].n}`);
  });

  // ── Test 8: the plain application role cannot invoke the bypass at all ──
  await withClient(APP_URL!, async (c) => {
    try {
      await c.query(`SET ROLE amacc_rls_bypass`);
      fail('plain app role cannot invoke the bypass role', 'SET ROLE unexpectedly succeeded');
    } catch (err: any) {
      if (/permission denied/i.test(err.message)) pass('plain application role cannot invoke the bypass role at all');
      else fail('plain app role cannot invoke bypass', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 9: tax_audit_reference is excluded from RLS (background drainer) ──
  await withClient(APP_URL!, async (c) => {
    const relrowsecurity = await c.query(`SELECT relrowsecurity FROM pg_class WHERE relname = 'tax_audit_reference'`);
    if (relrowsecurity.rows[0]?.relrowsecurity === false) pass('tax_audit_reference has RLS disabled (background audit drainer runs outside tenant context)');
    else fail('audit reference RLS excluded', `got ${JSON.stringify(relrowsecurity.rows[0])}`);
  });

  // ── Test 10: immutability — tax_result cannot be UPDATEd, even by the
  // owning tenant (INSERT-only evidence store, S124) ────────────────────
  const resultId = randomUUID();
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(
      `INSERT INTO tax_result
        (id, tenant_id, legal_entity_id, document_type, document_id, document_version, idempotency_key,
         status, engine_type, currency, total_taxable_base, total_tax, request_snapshot,
         correlation_id, business_date, calculated_at, created_at)
       VALUES ($1, $2, 'entity-1', 'COUNTER_SALE', 'doc-rls-1', 1, 'doc-rls-1-v1',
               'CALCULATED', 'TEST_FIXTURE_ENGINE', 'USD', 100.00, 10.00, '{}'::jsonb,
               'corr-1', '2025-06-01', now(), now())`,
      [resultId, tenantA],
    );
  });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await c.query(`UPDATE tax_result SET total_tax = 999.00 WHERE id = $1`, [resultId]);
      fail('immutability: tax_result cannot be UPDATEd', 'update unexpectedly succeeded');
    } catch (err: any) {
      if (/immutable/i.test(err.message)) pass('immutability trigger blocks UPDATE on tax_result, even for the owning tenant');
      else fail('tax_result immutability block', `unexpected error: ${err.message}`);
    }
  });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await c.query(`DELETE FROM tax_result WHERE id = $1`, [resultId]);
      fail('immutability: tax_result cannot be DELETEd', 'delete unexpectedly succeeded');
    } catch (err: any) {
      if (/immutable/i.test(err.message)) pass('immutability trigger blocks DELETE on tax_result, even for the owning tenant');
      else fail('tax_result immutability DELETE block', `unexpected error: ${err.message}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

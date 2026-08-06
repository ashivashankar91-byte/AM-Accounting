/**
 * CE-11 fixedops-service — PostgreSQL Row Level Security isolation proof,
 * against a real Postgres instance. Mirrors
 * services/tax-service/tests/live-db/rls-isolation.ts exactly (plain `pg`,
 * not Prisma — SET/set_config/SET ROLE are per-connection), scoped to this
 * service's own tables.
 *
 * Usage:
 *   services/fixedops-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... PG_APP_URL=... PG_ADMIN_URL=... \
 *     npx tsx services/fixedops-service/tests/live-db/rls-isolation.ts
 *   services/fixedops-service/tests/live-db/teardown.sh
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
function pass(label: string) { console.log(`  ✓ ${label}`); passed += 1; }
function fail(label: string, detail: string) { console.error(`  ✗ ${label} — ${detail}`); failed += 1; }

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function main() {
  const tenantA = `fo-rls-test-a-${randomUUID()}`;
  const tenantB = `fo-rls-test-b-${randomUUID()}`;
  const entityA1 = `entity-a1-${randomUUID()}`;
  const entityA2 = `entity-a2-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();

  async function insertRo(c: pg.Client, id: string, tenantId: string, legalEntityId: string, roNumber: string) {
    await c.query(
      `INSERT INTO repair_order
        (id, tenant_id, legal_entity_id, store_id, ro_number, status, current_close_version, opened_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'store-1', $4, 'OPEN', 0, now(), now(), now())`,
      [id, tenantId, legalEntityId, roNumber],
    );
  }

  // ── Setup: seed one row per tenant as the superuser (bypasses RLS) ────────
  await withClient(SUPERUSER_URL!, async (c) => {
    await insertRo(c, idA, tenantA, entityA1, 'RO-A-1');
    await insertRo(c, idB, tenantB, 'entity-b1', 'RO-B-1');
  });

  // ── Test 1: tenant A can read its own row, not tenant B's ────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT ro_number FROM repair_order WHERE id IN ($1, $2)`, [idA, idB]);
    const nums = res.rows.map((r) => r.ro_number);
    if (nums.length === 1 && nums[0] === 'RO-A-1') pass('tenant A reads its own repair_order row only (not tenant B\'s)');
    else fail('tenant A reads its own row only', `got ${JSON.stringify(nums)}`);
  });

  // ── Test 2: tenant A cannot UPDATE tenant B's row ─────────────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE repair_order SET status = 'VOIDED' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s repair_order row (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s row', `rowCount=${res.rowCount}`);
  });

  // ── Test 3: tenant A cannot INSERT a row claiming to be tenant B ──────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await insertRo(c, randomUUID(), tenantB, 'entity-injected', 'RO-INJECTED');
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a repair_order row claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 4: missing tenant context sees zero rows (deny-by-default) ──────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM repair_order WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero repair_order rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  // ── Test 5: RLS is tenant_id-keyed only — same-tenant, DIFFERENT legal
  // entity rows are still VISIBLE at the DB layer (cross-entity scoping is
  // an application-layer concern, not an RLS policy) ────────────────────
  const idA2 = randomUUID();
  await withClient(SUPERUSER_URL!, async (c) => { await insertRo(c, idA2, tenantA, entityA2, 'RO-A-2'); });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM repair_order WHERE id IN ($1, $2)`, [idA, idA2]);
    if (res.rows[0].n === 2) pass('RLS alone does not exclude a different legal entity within the same tenant (confirms app-layer must scope legalEntityId — see cross-entity-denial.ts)');
    else fail('RLS is tenant-scoped only', `got n=${res.rows[0].n}`);
  });

  // ── Test 6: admin without explicit bypass is still constrained ──────────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM repair_order WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 1) pass('admin role without explicit bypass is still constrained to its own tenant context');
    else fail('admin without bypass is constrained', `got n=${res.rows[0].n}`);
  });

  // ── Test 7: admin explicitly invoking the bypass role sees both tenants ─
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM repair_order WHERE id IN ($1, $2)`, [idA, idB]);
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

  // ── Test 9: fixedops_audit_outbox_event is excluded from RLS (background
  // drainer runs outside tenant request context). Note: this service has
  // no separate outbox_events table — that model was unused dead code and
  // was removed to avoid colliding with the genuinely shared outbox_events
  // table other services (gl-service et al.) already own. ─────────────────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'fixedops_audit_outbox_event'`);
    const disabled = res.rows.length === 1 && res.rows[0].relrowsecurity === false;
    if (disabled) pass('fixedops_audit_outbox_event has RLS disabled (background drainer runs outside tenant context)');
    else fail('outbox table RLS excluded', `got ${JSON.stringify(res.rows)}`);
  });

  // ── Test 10: cross-tenant isolation holds for a CHILD table too
  // (ro_distribution_line, keyed directly by its own tenant_id column) ────
  const submissionId = randomUUID();
  const lineIdA = randomUUID();
  const lineIdB = randomUUID();
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(
      `INSERT INTO ro_close_submission
        (id, tenant_id, legal_entity_id, store_id, repair_order_id, ro_number, close_version, source_event_id, correlation_id,
         business_date, pay_type_mix, total_sale_amount, total_cost_amount, status, actor, created_at)
       VALUES ($1, $2, $3, 'store-1', $4, 'RO-A-1', 1, 'evt-1', 'corr-1', '2026-08-01', 'C', 100.00, 40.00, 'POSTED', 'tester', now())`,
      [submissionId, tenantA, entityA1, idA],
    );
    await c.query(
      `INSERT INTO ro_distribution_line
        (id, tenant_id, ro_close_submission_id, line_id, pay_type, category, sale_amount, cost_amount, created_at)
       VALUES ($1, $2, $3, 'l1', 'C', 'LABOR', 100.00, 40.00, now())`,
      [lineIdA, tenantA, submissionId],
    );
  });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantB]);
    const res = await c.query(`SELECT count(*)::int AS n FROM ro_distribution_line WHERE id = $1`, [lineIdA]);
    if (res.rows[0].n === 0) pass('tenant B cannot see tenant A\'s ro_distribution_line child row (direct tenant_id RLS on a child table)');
    else fail('child table RLS isolation', `got n=${res.rows[0].n}`);
  });

  // ── Test 11: S063 gap-closure — labor_rate_config (new this session) is
  // tenant-scoped RLS exactly like every other table (proves the new
  // migration's RLS policies actually took effect, not just that the SQL
  // ran without error). ────────────────────────────────────────────────
  const rateIdA = randomUUID();
  const rateIdB = randomUUID();
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(
      `INSERT INTO labor_rate_config (id, tenant_id, legal_entity_id, scope, subject_key, burdened_rate, effective_from, created_at, created_by)
       VALUES ($1, $2, $3, 'DEPARTMENT', 'SVC', 28.50, '2020-01-01', now(), 'tester')`,
      [rateIdA, tenantA, entityA1],
    );
    await c.query(
      `INSERT INTO labor_rate_config (id, tenant_id, legal_entity_id, scope, subject_key, burdened_rate, effective_from, created_at, created_by)
       VALUES ($1, $2, 'entity-b1', 'DEPARTMENT', 'SVC', 25.00, '2020-01-01', now(), 'tester')`,
      [rateIdB, tenantB],
    );
  });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM labor_rate_config WHERE id IN ($1, $2)`, [rateIdA, rateIdB]);
    if (res.rows[0].n === 1) pass('tenant A reads its own labor_rate_config row only, not tenant B\'s (new S063 gap-closure table)');
    else fail('labor_rate_config tenant isolation', `got n=${res.rows[0].n}`);
  });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE labor_rate_config SET burdened_rate = 999 WHERE id = $1`, [rateIdB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s labor_rate_config row (0 rows affected)');
    else fail('labor_rate_config cross-tenant update', `rowCount=${res.rowCount}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

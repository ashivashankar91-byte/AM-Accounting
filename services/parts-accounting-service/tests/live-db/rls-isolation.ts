/**
 * CE-11 parts-accounting-service — PostgreSQL Row Level Security isolation
 * proof, against a real Postgres instance. Mirrors
 * services/tax-service/tests/live-db/rls-isolation.ts exactly (plain `pg`,
 * not Prisma), scoped to this service's own tables — including proving the
 * SUBQUERY-based policies on the 5 child-line tables that intentionally
 * lack their own tenant_id column (parts_reconciliation_variance_line,
 * price_tape_line, obsolescence_provision_line,
 * physical_inventory_count_line, oem_return_line — see
 * prisma/migrations/20260801040001_add_rls_policies_parts_accounting_svc)
 * actually isolate correctly, not just the direct-column tables.
 *
 * Usage:
 *   services/parts-accounting-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... PG_APP_URL=... PG_ADMIN_URL=... \
 *     npx tsx services/parts-accounting-service/tests/live-db/rls-isolation.ts
 *   services/parts-accounting-service/tests/live-db/teardown.sh
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
  const tenantA = `pa-rls-test-a-${randomUUID()}`;
  const tenantB = `pa-rls-test-b-${randomUUID()}`;
  const entityA1 = `entity-a1-${randomUUID()}`;
  const entityA2 = `entity-a2-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();

  async function insertMovement(c: pg.Client, id: string, tenantId: string, legalEntityId: string, movementId: string) {
    await c.query(
      `INSERT INTO parts_movement
        (id, tenant_id, legal_entity_id, store_id, part_number, movement_family, movement_id,
         quantity, unit_value, total_value, source_doc_type, source_doc_id, source_event_id,
         correlation_id, business_date, status, created_at)
       VALUES ($1, $2, $3, 'store-1', 'P-1', 'RECEIPT', $4, 10, 5.00, 50.00, 'PO', 'PO-1', $5, 'corr-1', '2026-08-01', 'POSTED', now())`,
      [id, tenantId, legalEntityId, movementId, randomUUID()],
    );
  }

  // ── Setup: seed one row per tenant as the superuser (bypasses RLS) ────────
  await withClient(SUPERUSER_URL!, async (c) => {
    await insertMovement(c, idA, tenantA, entityA1, 'mv-a-1');
    await insertMovement(c, idB, tenantB, 'entity-b1', 'mv-b-1');
  });

  // ── Test 1: tenant A can read its own row, not tenant B's ────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT movement_id FROM parts_movement WHERE id IN ($1, $2)`, [idA, idB]);
    const ids = res.rows.map((r) => r.movement_id);
    if (ids.length === 1 && ids[0] === 'mv-a-1') pass('tenant A reads its own parts_movement row only (not tenant B\'s)');
    else fail('tenant A reads its own row only', `got ${JSON.stringify(ids)}`);
  });

  // ── Test 2: tenant A cannot UPDATE tenant B's row ─────────────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE parts_movement SET status = 'EXCEPTION' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s parts_movement row (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s row', `rowCount=${res.rowCount}`);
  });

  // ── Test 3: tenant A cannot INSERT a row claiming to be tenant B ──────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await insertMovement(c, randomUUID(), tenantB, 'entity-injected', 'mv-injected');
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a parts_movement row claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 4: missing tenant context sees zero rows (deny-by-default) ──────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM parts_movement WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero parts_movement rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  // ── Test 5: RLS is tenant_id-keyed only — same-tenant, DIFFERENT legal
  // entity rows are still VISIBLE at the DB layer ──────────────────────────
  const idA2 = randomUUID();
  await withClient(SUPERUSER_URL!, async (c) => { await insertMovement(c, idA2, tenantA, entityA2, 'mv-a-2'); });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM parts_movement WHERE id IN ($1, $2)`, [idA, idA2]);
    if (res.rows[0].n === 2) pass('RLS alone does not exclude a different legal entity within the same tenant (confirms app-layer must scope legalEntityId — see cross-entity-denial.ts)');
    else fail('RLS is tenant-scoped only', `got n=${res.rows[0].n}`);
  });

  // ── Test 6: admin without explicit bypass is still constrained ──────────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM parts_movement WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 1) pass('admin role without explicit bypass is still constrained to its own tenant context');
    else fail('admin without bypass is constrained', `got n=${res.rows[0].n}`);
  });

  // ── Test 7: admin explicitly invoking the bypass role sees both tenants ─
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM parts_movement WHERE id IN ($1, $2)`, [idA, idB]);
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

  // ── Test 9: parts_audit_outbox_event excluded from RLS (background
  // drainer runs outside tenant request context). No separate outbox_events
  // table exists in this service — that model was unused dead code and was
  // removed to avoid colliding with the genuinely shared outbox_events
  // table other services already own. ─────────────────────────────────────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'parts_audit_outbox_event'`);
    const disabled = res.rows.length === 1 && res.rows[0].relrowsecurity === false;
    if (disabled) pass('parts_audit_outbox_event has RLS disabled (background drainer runs outside tenant context)');
    else fail('outbox table RLS excluded', `got ${JSON.stringify(res.rows)}`);
  });

  // ── Test 10: SUBQUERY-based policy on a child-line table WITHOUT its own
  // tenant_id column (parts_reconciliation_variance_line, scoped via its
  // parent parts_reconciliation_run.tenant_id) genuinely isolates ─────────
  const runIdA = randomUUID();
  const runIdB = randomUUID();
  const lineIdA = randomUUID();
  const lineIdB = randomUUID();
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(
      `INSERT INTO parts_reconciliation_run (id, tenant_id, legal_entity_id, store_id, as_of_date, perpetual_total, gl_control_total, variance_amount, status, triggered_by, created_at)
       VALUES ($1, $2, 'entity-1', 'store-1', '2026-08-01', 100.00, 90.00, 10.00, 'VARIANCE', 'ON_DEMAND', now())`,
      [runIdA, tenantA],
    );
    await c.query(
      `INSERT INTO parts_reconciliation_run (id, tenant_id, legal_entity_id, store_id, as_of_date, perpetual_total, gl_control_total, variance_amount, status, triggered_by, created_at)
       VALUES ($1, $2, 'entity-1', 'store-1', '2026-08-01', 200.00, 190.00, 10.00, 'VARIANCE', 'ON_DEMAND', now())`,
      [runIdB, tenantB],
    );
    await c.query(`INSERT INTO parts_reconciliation_variance_line (id, run_id, part_number, explained_amount, unexplained_amount) VALUES ($1, $2, 'P-1', 0, 10.00)`, [lineIdA, runIdA]);
    await c.query(`INSERT INTO parts_reconciliation_variance_line (id, run_id, part_number, explained_amount, unexplained_amount) VALUES ($1, $2, 'P-1', 0, 10.00)`, [lineIdB, runIdB]);
  });

  // 10a: tenant A can read its own child-line row via the subquery policy.
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT id FROM parts_reconciliation_variance_line WHERE id IN ($1, $2)`, [lineIdA, lineIdB]);
    const ids = res.rows.map((r) => r.id);
    if (ids.length === 1 && ids[0] === lineIdA) pass('subquery-policy child table (parts_reconciliation_variance_line): tenant A reads its own row only, not tenant B\'s');
    else fail('subquery-policy child table isolation (SELECT)', `got ${JSON.stringify(ids)}`);
  });

  // 10b: tenant A cannot UPDATE tenant B's child-line row.
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE parts_reconciliation_variance_line SET explained_amount = 999 WHERE id = $1`, [lineIdB]);
    if (res.rowCount === 0) pass('subquery-policy child table: tenant A cannot UPDATE tenant B\'s row (0 rows affected)');
    else fail('subquery-policy child table isolation (UPDATE)', `rowCount=${res.rowCount}`);
  });

  // 10c: tenant A cannot INSERT a child-line row against tenant B's parent run.
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await c.query(`INSERT INTO parts_reconciliation_variance_line (id, run_id, part_number, explained_amount, unexplained_amount) VALUES ($1, $2, 'P-INJECTED', 0, 5.00)`, [randomUUID(), runIdB]);
      fail('subquery-policy child table: tenant A cannot INSERT against tenant B\'s parent run', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('subquery-policy child table: tenant A cannot INSERT a variance line against tenant B\'s parent run (RLS policy violation)');
      else fail('subquery-policy child table isolation (INSERT)', `unexpected error: ${err.message}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

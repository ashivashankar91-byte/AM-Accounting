/**
 * S021 Posting Recovery — PostgreSQL Row Level Security isolation proof,
 * against a real Postgres instance. Mirrors
 * tests/integration/test-rls-isolation.ts exactly (plain `pg`, not Prisma —
 * SET/set_config/SET ROLE are per-connection, so this needs precise control
 * over which single physical connection each assertion runs on), scoped to
 * this service's own tables.
 *
 * Usage:
 *   services/posting-recovery-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... PG_APP_URL=... PG_ADMIN_URL=... \
 *     npx tsx services/posting-recovery-service/tests/live-db/rls-isolation.ts
 *   services/posting-recovery-service/tests/live-db/teardown.sh
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

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const tenantA = `pr-rls-test-a-${randomUUID()}`;
  const tenantB = `pr-rls-test-b-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();
  const ts = nowIso();

  async function insertDeadLetter(c: pg.Client, id: string, tenantId: string, code: string) {
    await c.query(
      `INSERT INTO posting_dead_letter
        (id, tenant_id, source_event_id, source_event_type, source_system, correlation_id,
         original_event_timestamp, posting_idempotency_key, payload, payload_hash,
         status, first_failure_at, latest_failure_at, latest_failure_category, latest_failure_code, latest_failure_message,
         created_at, updated_at)
       VALUES ($1, $2, $3, 'TEST_EVENT', 'test-source', $4, $5, $6, '{}'::jsonb, 'hash-' || $1,
               'QUARANTINED', $5, $5, 'UNKNOWN_FAILURE', $7, 'test failure', now(), now())`,
      [id, tenantId, `evt-${code}`, `corr-${code}`, ts, `idem-${code}`, `CODE_${code}`],
    );
  }

  // ── Setup: seed one row per tenant as the superuser (bypasses RLS) ────────
  await withClient(SUPERUSER_URL!, async (c) => {
    await insertDeadLetter(c, idA, tenantA, 'A');
    await insertDeadLetter(c, idB, tenantB, 'B');
  });

  // ── Test 1: tenant A can read its own row, not tenant B's ────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT source_event_id FROM posting_dead_letter WHERE id IN ($1, $2)`, [idA, idB]);
    const ids = res.rows.map((r) => r.source_event_id);
    if (ids.length === 1 && ids[0] === 'evt-A') pass('tenant A reads its own posting_dead_letter row only (not tenant B\'s)');
    else fail('tenant A reads its own row only', `got ${JSON.stringify(ids)}`);
  });

  // ── Test 2: tenant A cannot UPDATE tenant B's row ─────────────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE posting_dead_letter SET assigned_owner = 'hacked' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s posting_dead_letter row (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s row', `rowCount=${res.rowCount}`);
  });

  // ── Test 3: tenant A cannot DELETE tenant B's row (RLS + immutability both apply) ──
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`DELETE FROM posting_dead_letter WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot DELETE tenant B\'s row (0 rows affected — RLS blocks visibility before the immutability trigger would even fire)');
    else fail('tenant A cannot DELETE tenant B\'s row', `rowCount=${res.rowCount}`);
  });
  await withClient(SUPERUSER_URL!, async (c) => {
    const res = await c.query(`SELECT source_event_id FROM posting_dead_letter WHERE id = $1`, [idB]);
    if (res.rows[0]?.source_event_id === 'evt-B') pass('tenant B\'s row is genuinely untouched (verified via superuser)');
    else fail('tenant B\'s row is genuinely untouched', `got ${JSON.stringify(res.rows[0])}`);
  });

  // ── Test 4: tenant A cannot INSERT a row claiming to be tenant B ──────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await insertDeadLetter(c, randomUUID(), tenantB, 'INJECTED');
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a posting_dead_letter row claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 5: missing tenant context sees zero rows (deny-by-default) ──────
  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM posting_dead_letter WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero posting_dead_letter rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  // ── Test 6/7: child tables (own tenant_id column) — attempts + failures ──
  const attemptId = randomUUID();
  const failureId = randomUUID();
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(
      `INSERT INTO posting_replay_attempt (id, tenant_id, dead_letter_id, attempt_number, status, requested_by, requested_at, created_at)
       VALUES ($1, $2, $3, 1, 'REQUESTED', 'tester', now(), now())`,
      [attemptId, tenantB, idB],
    );
    await c.query(
      `INSERT INTO posting_dead_letter_failure (id, tenant_id, dead_letter_id, failure_category, failure_code, failure_stage, failure_message, occurred_at, created_at)
       VALUES ($1, $2, $3, 'UNKNOWN_FAILURE', 'CODE_B', 'UNKNOWN', 'test', now(), now())`,
      [failureId, tenantB, idB],
    );
  });
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const attempts = await c.query(`SELECT count(*)::int AS n FROM posting_replay_attempt WHERE id = $1`, [attemptId]);
    if (attempts.rows[0].n === 0) pass('tenant A cannot read tenant B\'s posting_replay_attempt row');
    else fail('tenant A cannot read tenant B\'s attempt row', `got n=${attempts.rows[0].n}`);

    const failures = await c.query(`SELECT count(*)::int AS n FROM posting_dead_letter_failure WHERE id = $1`, [failureId]);
    if (failures.rows[0].n === 0) pass('tenant A cannot read tenant B\'s posting_dead_letter_failure row');
    else fail('tenant A cannot read tenant B\'s failure row', `got n=${failures.rows[0].n}`);
  });

  // ── Test 8: append-only trigger — even the OWNING tenant cannot UPDATE a failure row ──
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantB]);
    try {
      await c.query(`UPDATE posting_dead_letter_failure SET failure_message = 'tampered' WHERE id = $1`, [failureId]);
      fail('append-only: owning tenant cannot UPDATE a failure row', 'update unexpectedly succeeded');
    } catch (err: any) {
      if (/append-only/i.test(err.message)) pass('append-only trigger blocks UPDATE on posting_dead_letter_failure even for the owning tenant');
      else fail('append-only UPDATE block', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 9: immutability trigger — owning tenant cannot change original-event fields ──
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantB]);
    try {
      await c.query(`UPDATE posting_dead_letter SET source_event_id = 'tampered' WHERE id = $1`, [idB]);
      fail('immutability: source_event_id cannot be changed', 'update unexpectedly succeeded');
    } catch (err: any) {
      if (/immutable/i.test(err.message)) pass('immutability trigger blocks changing posting_dead_letter.source_event_id, even for the owning tenant');
      else fail('immutability source_event_id block', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 10: owning tenant CAN update a mutable field (status) ───────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantB]);
    const res = await c.query(`UPDATE posting_dead_letter SET status = 'UNDER_REVIEW' WHERE id = $1`, [idB]);
    if (res.rowCount === 1) pass('owning tenant CAN update a mutable field (status) on its own row');
    else fail('owning tenant can update status', `rowCount=${res.rowCount}`);
  });

  // ── Test 11: no hard deletion, even for the owning tenant ────────────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantB]);
    try {
      await c.query(`DELETE FROM posting_dead_letter WHERE id = $1`, [idB]);
      fail('no hard deletion of posting_dead_letter, even for the owning tenant', 'delete unexpectedly succeeded');
    } catch (err: any) {
      if (/cannot be deleted/i.test(err.message)) pass('immutability trigger blocks DELETE on posting_dead_letter, even for the owning tenant');
      else fail('no hard deletion block', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 12: admin without explicit bypass is still constrained ──────────
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT count(*)::int AS n FROM posting_dead_letter WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 1) pass('admin role without explicit bypass is still constrained to its own tenant context');
    else fail('admin without bypass is constrained', `got n=${res.rows[0].n}`);
  });

  // ── Test 13: admin explicitly invoking the bypass role sees both tenants ─
  await withClient(ADMIN_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM posting_dead_letter WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`RESET ROLE`);
    if (res.rows[0].n === 2) pass('admin explicitly invoking amacc_rls_bypass sees both tenants (explicit, auditable bypass works)');
    else fail('explicit bypass sees both tenants', `got n=${res.rows[0].n}`);
  });

  // ── Test 14: the plain application role cannot invoke the bypass at all ──
  await withClient(APP_URL!, async (c) => {
    try {
      await c.query(`SET ROLE amacc_rls_bypass`);
      fail('plain app role cannot invoke the bypass role', 'SET ROLE unexpectedly succeeded');
    } catch (err: any) {
      if (/permission denied/i.test(err.message)) pass('plain application role cannot invoke the bypass role at all');
      else fail('plain app role cannot invoke bypass', `unexpected error: ${err.message}`);
    }
  });

  // ── Test 15: posting_recovery_audit_reference is excluded from RLS (background drainer) ──
  await withClient(APP_URL!, async (c) => {
    const relrowsecurity = await c.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'posting_recovery_audit_reference'`,
    );
    if (relrowsecurity.rows[0]?.relrowsecurity === false) pass('posting_recovery_audit_reference has RLS disabled (background audit drainer runs outside tenant context)');
    else fail('audit reference RLS excluded', `got ${JSON.stringify(relrowsecurity.rows[0])}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

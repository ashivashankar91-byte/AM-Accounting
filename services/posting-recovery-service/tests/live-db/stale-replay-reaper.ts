/**
 * CE-07 integration — real-Postgres proof of the crash/restart recovery fix
 * for ReplayReaperService.reapStaleReplays(): a case stuck in
 * REPLAY_IN_PROGRESS since before the staleness threshold is reclaimed by
 * the exact SQL shape the service issues; a case still genuinely in flight
 * (lock younger than the threshold) is left untouched; and — the part a
 * unit test with a mocked Prisma client cannot prove — a stale case
 * belonging to a DIFFERENT tenant is invisible to the reap query even
 * though its replay_lock_acquired_at alone would otherwise match, because
 * RLS (app.current_tenant_id) narrows the WHERE clause before the
 * staleness predicate is ever evaluated for it.
 *
 * Usage:
 *   services/posting-recovery-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... PG_APP_URL=... \
 *     npx tsx services/posting-recovery-service/tests/live-db/stale-replay-reaper.ts
 *   services/posting-recovery-service/tests/live-db/teardown.sh
 */
import pg from 'pg';
import { randomUUID } from 'crypto';

const SUPERUSER_URL = process.env['PG_SUPERUSER_URL'];
const APP_URL = process.env['PG_APP_URL'];

if (!SUPERUSER_URL || !APP_URL) {
  console.error('PG_SUPERUSER_URL and PG_APP_URL must both be set. See file header for usage.');
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

const STALE_LOCK_AT = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
const FRESH_LOCK_AT = new Date(Date.now() - 30 * 1000).toISOString(); // 30s ago
const REAP_THRESHOLD = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5-minute default

async function seedInProgressCase(c: pg.Client, id: string, tenantId: string, lockAcquiredAt: string) {
  const ts = new Date().toISOString();
  await c.query(
    `INSERT INTO posting_dead_letter (
      id, tenant_id, source_event_id, source_event_type, event_schema_version, source_system,
      source_entity_type, source_entity_id, correlation_id, original_event_timestamp, business_date,
      posting_idempotency_key, payload, payload_hash, status, first_failure_at, latest_failure_at,
      latest_failure_category, latest_failure_code, latest_failure_message, attempt_count, version,
      replay_lock_acquired_at, updated_at
    ) VALUES (
      $1, $2, $3, 'ro.closed', '1.0', 'service-dept',
      'ro', 'ro-123', $4, $5::timestamp, $5::date,
      'idem-key-1', '{"a":1}'::jsonb, 'hash-1', 'REPLAY_IN_PROGRESS', $5::timestamp, $5::timestamp,
      'RULE_NOT_FOUND', 'NO_RULE', 'no rule matched', 1, 4,
      $6::timestamp, $5::timestamp
    )`,
    [id, tenantId, `evt-${id}`, `corr-${id}`, ts, lockAcquiredAt],
  );
}

// Mirrors ReplayReaperService.reapStaleReplays()'s per-row reclaim UPDATE exactly.
async function attemptReap(c: pg.Client, id: string) {
  const res = await c.query(
    `UPDATE posting_dead_letter
     SET status = 'AWAITING_CORRECTION', replay_lock_acquired_at = NULL,
         version = version + 1, attempt_count = attempt_count + 1
     WHERE id = $1 AND status = 'REPLAY_IN_PROGRESS' AND replay_lock_acquired_at < $2
     RETURNING id, status, version, attempt_count, replay_lock_acquired_at`,
    [id, REAP_THRESHOLD],
  );
  return res;
}

async function main() {
  const tenantA = `pr-reaper-test-a-${randomUUID()}`;
  const tenantB = `pr-reaper-test-b-${randomUUID()}`;
  const staleA = randomUUID();
  const freshA = randomUUID();
  const staleB = randomUUID();

  await withClient(SUPERUSER_URL!, async (c) => {
    await seedInProgressCase(c, staleA, tenantA, STALE_LOCK_AT);
    await seedInProgressCase(c, freshA, tenantA, FRESH_LOCK_AT);
    await seedInProgressCase(c, staleB, tenantB, STALE_LOCK_AT);
  });

  // ── Test 1: a genuinely stale case IS reclaimed, under its own tenant context ──
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await attemptReap(c, staleA);
    if (res.rowCount === 1 && res.rows[0].status === 'AWAITING_CORRECTION' && res.rows[0].version === 5 && res.rows[0].attempt_count === 2 && res.rows[0].replay_lock_acquired_at === null) {
      pass('a stale (>5min) REPLAY_IN_PROGRESS lock is reclaimed to AWAITING_CORRECTION, version+1, attempt_count+1, lock cleared');
    } else {
      fail('stale lock reclaimed correctly', `rowCount=${res.rowCount}, row=${JSON.stringify(res.rows[0])}`);
    }
  });

  // ── Test 2: a fresh (genuinely in-flight) lock is NOT reclaimed ──────────
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await attemptReap(c, freshA);
    if (res.rowCount === 0) pass('a fresh (30s old) REPLAY_IN_PROGRESS lock is left untouched — not old enough to be considered stale');
    else fail('fresh lock left untouched', `rowCount=${res.rowCount}, expected 0`);
  });
  await withClient(SUPERUSER_URL!, async (c) => {
    const res = await c.query(`SELECT status FROM posting_dead_letter WHERE id = $1`, [freshA]);
    if (res.rows[0]?.status === 'REPLAY_IN_PROGRESS') pass('the fresh case genuinely still shows REPLAY_IN_PROGRESS (verified via superuser)');
    else fail('fresh case still REPLAY_IN_PROGRESS', `got ${JSON.stringify(res.rows[0])}`);
  });

  // ── Test 3 (the RLS + crash-recovery combination): tenant A's reap cannot
  // touch tenant B's stale case, even though replay_lock_acquired_at alone
  // would match — RLS narrows the WHERE clause to tenant A's rows first. ──
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await attemptReap(c, staleB);
    if (res.rowCount === 0) pass('tenant A\'s reap cannot reclaim tenant B\'s stale REPLAY_IN_PROGRESS case (RLS isolation holds under the reaper\'s own SQL shape)');
    else fail('cross-tenant reap blocked by RLS', `rowCount=${res.rowCount}, expected 0`);
  });
  await withClient(SUPERUSER_URL!, async (c) => {
    const res = await c.query(`SELECT status, replay_lock_acquired_at FROM posting_dead_letter WHERE id = $1`, [staleB]);
    if (res.rows[0]?.status === 'REPLAY_IN_PROGRESS' && res.rows[0]?.replay_lock_acquired_at !== null) {
      pass('tenant B\'s stale case is genuinely untouched (verified via superuser)');
    } else {
      fail('tenant B\'s case untouched', `got ${JSON.stringify(res.rows[0])}`);
    }
  });

  // ── Test 4: tenant B can reap its own stale case under its own context ──
  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantB]);
    const res = await attemptReap(c, staleB);
    if (res.rowCount === 1) pass('tenant B can reap its own stale case under its own tenant context');
    else fail('tenant B reaps its own case', `rowCount=${res.rowCount}, expected 1`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

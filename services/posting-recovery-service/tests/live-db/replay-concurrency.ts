/**
 * S021 R1 completion — real-Postgres proof that the replay ownership CAS
 * (ReplayService.replay()'s `updateMany({ where: { status, version } })`)
 * is genuinely race-safe under concurrent connections, not just correct in
 * single-threaded unit tests. Issues the exact SQL shape ReplayService uses
 * — `UPDATE posting_dead_letter SET status='REPLAY_IN_PROGRESS', version=
 * version+1 WHERE id=$1 AND status='READY_FOR_REPLAY' AND version=$2` — from
 * two separate physical connections, fired concurrently, and asserts
 * exactly one affects a row.
 *
 * Usage:
 *   services/posting-recovery-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... npx tsx services/posting-recovery-service/tests/live-db/replay-concurrency.ts
 *   services/posting-recovery-service/tests/live-db/teardown.sh
 */
import pg from 'pg';
import { randomUUID } from 'crypto';

const SUPERUSER_URL = process.env['PG_SUPERUSER_URL'];
if (!SUPERUSER_URL) {
  console.error('PG_SUPERUSER_URL must be set. See file header for usage.');
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

async function insertReadyCase(c: pg.Client, id: string, tenantId: string) {
  const ts = nowIso();
  await c.query(
    `INSERT INTO posting_dead_letter (
      id, tenant_id, source_event_id, source_event_type, event_schema_version, source_system,
      source_entity_type, source_entity_id, correlation_id, original_event_timestamp, business_date,
      posting_idempotency_key, payload, payload_hash, status, first_failure_at, latest_failure_at,
      latest_failure_category, latest_failure_code, latest_failure_message, attempt_count, version,
      updated_at
    ) VALUES (
      $1, $2, $3, 'ro.closed', '1.0', 'service-dept',
      'ro', 'ro-123', $4, $5::timestamp, $5::date,
      'idem-key-1', '{"a":1}'::jsonb, 'hash-1', 'READY_FOR_REPLAY', $5::timestamp, $5::timestamp,
      'RULE_NOT_FOUND', 'NO_RULE', 'no rule matched', 0, 1,
      $5::timestamp
    )`,
    [id, tenantId, `evt-${id}`, `corr-${id}`, ts],
  );
}

async function main() {
  const tenantId = `pr-concurrency-test-${randomUUID()}`;
  const deadLetterId = randomUUID();

  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`SET app.current_tenant_id = '${tenantId}'`);
    await insertReadyCase(c, deadLetterId, tenantId);
  });

  // Fire two concurrent CAS attempts from two SEPARATE physical connections —
  // this is the whole point: a single connection can't race itself.
  const attempt = async () => {
    return withClient(SUPERUSER_URL!, async (c) => {
      await c.query(`SET app.current_tenant_id = '${tenantId}'`);
      const res = await c.query(
        `UPDATE posting_dead_letter SET status = 'REPLAY_IN_PROGRESS', version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND status = 'READY_FOR_REPLAY' AND version = 1`,
        [deadLetterId, tenantId],
      );
      return res.rowCount;
    });
  };

  const [a, b] = await Promise.all([attempt(), attempt()]);
  const winners = [a, b].filter((n) => n === 1).length;
  const losers = [a, b].filter((n) => n === 0).length;

  if (winners === 1 && losers === 1) {
    pass(`exactly one of two concurrent CAS attempts won ownership (rowCounts: ${a}, ${b})`);
  } else {
    fail('exactly one concurrent CAS attempt wins', `rowCounts were ${a}, ${b} (expected exactly one 1 and one 0)`);
  }

  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`SET app.current_tenant_id = '${tenantId}'`);
    const res = await c.query(`SELECT status, version FROM posting_dead_letter WHERE id = $1`, [deadLetterId]);
    const row = res.rows[0];
    if (row.status === 'REPLAY_IN_PROGRESS' && row.version === 2) {
      pass(`case ended in REPLAY_IN_PROGRESS with version=2 (not double-incremented): got status=${row.status}, version=${row.version}`);
    } else {
      fail('case reflects exactly one applied CAS', `got status=${row.status}, version=${row.version}`);
    }
  });

  // A third attempt, after the first CAS already moved status away from
  // READY_FOR_REPLAY, must also be rejected (not just the concurrent pair).
  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`SET app.current_tenant_id = '${tenantId}'`);
    const res = await c.query(
      `UPDATE posting_dead_letter SET status = 'REPLAY_IN_PROGRESS', version = version + 1
       WHERE id = $1 AND tenant_id = $2 AND status = 'READY_FOR_REPLAY' AND version = 2`,
      [deadLetterId, tenantId],
    );
    if (res.rowCount === 0) pass('a subsequent CAS attempt against an already-in-progress case is also rejected');
    else fail('subsequent CAS rejected', `rowCount was ${res.rowCount}, expected 0`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

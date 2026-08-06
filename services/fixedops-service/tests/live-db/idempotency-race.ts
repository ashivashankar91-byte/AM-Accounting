/**
 * CE-11 fixedops-service — real-Postgres proof that the unique constraint
 * on (tenant_id, ro_number, close_version) genuinely enforces RO-close
 * idempotency under a real concurrent race — not just correct in the
 * in-memory fake used by tests/application/ro-close-service.test.ts. Fires
 * two concurrent INSERTs with the SAME (tenant_id, ro_number,
 * close_version) from two separate physical connections and asserts
 * exactly one commits (mirrors coa-service's own P2002-race-reconciliation
 * pattern, proven here at the raw-SQL layer this service's Prisma unique
 * constraint actually compiles down to).
 *
 * Also proves the sibling unique constraint on ro_reversal
 * (tenant_id, ro_number, close_version_reversed, action) races the same way
 * for concurrent reopen/void attempts (S060 AC: "race on simultaneous
 * reopen+payment resolves to one winner").
 *
 * Usage:
 *   services/fixedops-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... npx tsx services/fixedops-service/tests/live-db/idempotency-race.ts
 *   services/fixedops-service/tests/live-db/teardown.sh
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
function pass(label: string) { console.log(`  ✓ ${label}`); passed += 1; }
function fail(label: string, detail: string) { console.error(`  ✗ ${label} — ${detail}`); failed += 1; }

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

function insertCloseSql(id: string, tenantId: string, roId: string, roNumber: string, closeVersion: number, sourceEventId: string) {
  return {
    text: `INSERT INTO ro_close_submission
      (id, tenant_id, legal_entity_id, store_id, repair_order_id, ro_number, close_version, source_event_id, correlation_id,
       business_date, pay_type_mix, total_sale_amount, total_cost_amount, status, actor, created_at)
     VALUES ($1, $2, 'entity-1', 'store-1', $3, $4, $5, $6, 'corr-race',
             '2026-08-01', 'C', 100.00, 40.00, 'POSTED', 'race-tester', now())`,
    values: [id, tenantId, roId, roNumber, closeVersion, sourceEventId],
  };
}

async function main() {
  const tenantId = `fo-race-tenant-${randomUUID()}`;
  const roId = randomUUID();

  await withClient(SUPERUSER_URL!, (c) =>
    c.query(
      `INSERT INTO repair_order (id, tenant_id, legal_entity_id, store_id, ro_number, status, current_close_version, opened_at, created_at, updated_at)
       VALUES ($1, $2, 'entity-1', 'store-1', 'RO-RACE-1', 'OPEN', 0, now(), now(), now())`,
      [roId, tenantId],
    ),
  );

  // ── Two concurrent close-submission inserts under the same (tenant, RO#,
  // closeVersion) — exactly one commits ────────────────────────────────────
  const results = await Promise.allSettled([
    withClient(SUPERUSER_URL!, (c) => c.query(insertCloseSql(randomUUID(), tenantId, roId, 'RO-RACE-1', 1, 'evt-race-a'))),
    withClient(SUPERUSER_URL!, (c) => c.query(insertCloseSql(randomUUID(), tenantId, roId, 'RO-RACE-1', 1, 'evt-race-b'))),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  if (fulfilled === 1 && rejected === 1) {
    pass('exactly one of two concurrent RO-close inserts under the same (tenant, RO#, closeVersion) commits (unique constraint enforced)');
  } else {
    fail('concurrent RO-close race', `fulfilled=${fulfilled} rejected=${rejected}`);
  }
  const rejectedReason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason;
  if (rejectedReason && /duplicate key value violates unique constraint/i.test(String(rejectedReason.message ?? rejectedReason))) {
    pass('the losing RO-close insert fails with a real unique-constraint violation (P2002-equivalent), not a silent overwrite');
  } else {
    fail('losing insert error shape', `got ${String(rejectedReason?.message ?? rejectedReason)}`);
  }

  // ── A DIFFERENT closeVersion (re-close after reopen) does not collide ───
  const secondClose = await withClient(SUPERUSER_URL!, (c) => c.query(insertCloseSql(randomUUID(), tenantId, roId, 'RO-RACE-1', 2, 'evt-race-c')));
  if (secondClose.rowCount === 1) pass('a re-close under a NEW closeVersion inserts cleanly (never blocked by the prior version\'s row)');
  else fail('re-close under new closeVersion', `rowCount=${secondClose.rowCount}`);

  // ── Two concurrent reopen/void reversal inserts under the same
  // (tenant, RO#, closeVersionReversed, action) — exactly one commits ─────
  const reversalResults = await Promise.allSettled([
    withClient(SUPERUSER_URL!, (c) =>
      c.query(
        `INSERT INTO ro_reversal (id, tenant_id, repair_order_id, ro_number, close_version_reversed, action, original_journal_entry_id, source_event_id, correlation_id, status, actor, created_at)
         VALUES ($1, $2, $3, 'RO-RACE-1', 1, 'REOPEN', 'je-orig', 'evt-rev-a', 'corr-rev', 'COMPLETED', 'race-tester', now())`,
        [randomUUID(), tenantId, roId],
      ),
    ),
    withClient(SUPERUSER_URL!, (c) =>
      c.query(
        `INSERT INTO ro_reversal (id, tenant_id, repair_order_id, ro_number, close_version_reversed, action, original_journal_entry_id, source_event_id, correlation_id, status, actor, created_at)
         VALUES ($1, $2, $3, 'RO-RACE-1', 1, 'REOPEN', 'je-orig', 'evt-rev-b', 'corr-rev', 'COMPLETED', 'race-tester', now())`,
        [randomUUID(), tenantId, roId],
      ),
    ),
  ]);
  const revFulfilled = reversalResults.filter((r) => r.status === 'fulfilled').length;
  const revRejected = reversalResults.filter((r) => r.status === 'rejected').length;
  if (revFulfilled === 1 && revRejected === 1) {
    pass('exactly one of two concurrent reopen reversals under the same (tenant, RO#, closeVersionReversed, action) commits — race resolves to one winner (S060 AC)');
  } else {
    fail('concurrent reversal race', `fulfilled=${revFulfilled} rejected=${revRejected}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

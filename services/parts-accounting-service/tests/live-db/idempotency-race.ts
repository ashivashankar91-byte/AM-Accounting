/**
 * CE-11 parts-accounting-service — real-Postgres proof that the unique
 * constraint on (tenant_id, movement_id) genuinely enforces movement
 * idempotency under a real concurrent race — not just correct in the
 * in-memory fake used by tests/application/movement-service.test.ts and
 * tests/golden/parts-movement-families.test.ts. Fires two concurrent
 * INSERTs with the SAME (tenant_id, movement_id) from two separate
 * physical connections and asserts exactly one commits (S066 AC: "one
 * movement = one journal, idempotent per movementId").
 *
 * Usage:
 *   services/parts-accounting-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... npx tsx services/parts-accounting-service/tests/live-db/idempotency-race.ts
 *   services/parts-accounting-service/tests/live-db/teardown.sh
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

function insertMovementSql(id: string, tenantId: string, movementId: string, sourceEventId: string) {
  return {
    text: `INSERT INTO parts_movement
      (id, tenant_id, legal_entity_id, store_id, part_number, movement_family, movement_id,
       quantity, unit_value, total_value, source_doc_type, source_doc_id, source_event_id,
       correlation_id, business_date, status, created_at)
     VALUES ($1, $2, 'entity-1', 'store-1', 'P-RACE', 'RECEIPT', $3, 10, 5.00, 50.00, 'PO', 'PO-RACE', $4, 'corr-race', '2026-08-01', 'POSTED', now())`,
    values: [id, tenantId, movementId, sourceEventId],
  };
}

async function main() {
  const tenantId = `pa-race-tenant-${randomUUID()}`;

  // ── Two concurrent movement inserts under the same (tenant, movementId) —
  // exactly one commits ─────────────────────────────────────────────────
  const movementId = `mv-race-${randomUUID()}`;
  const results = await Promise.allSettled([
    withClient(SUPERUSER_URL!, (c) => c.query(insertMovementSql(randomUUID(), tenantId, movementId, randomUUID()))),
    withClient(SUPERUSER_URL!, (c) => c.query(insertMovementSql(randomUUID(), tenantId, movementId, randomUUID()))),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  if (fulfilled === 1 && rejected === 1) {
    pass('exactly one of two concurrent parts_movement inserts under the same (tenant, movementId) commits (unique constraint enforced)');
  } else {
    fail('concurrent movement race', `fulfilled=${fulfilled} rejected=${rejected}`);
  }
  const rejectedReason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason;
  if (rejectedReason && /duplicate key value violates unique constraint/i.test(String(rejectedReason.message ?? rejectedReason))) {
    pass('the losing movement insert fails with a real unique-constraint violation (P2002-equivalent), not a silent overwrite/double-post');
  } else {
    fail('losing insert error shape', `got ${String(rejectedReason?.message ?? rejectedReason)}`);
  }

  // ── A DIFFERENT movementId for the same part/store does not collide ────
  const secondMovement = await withClient(SUPERUSER_URL!, (c) => c.query(insertMovementSql(randomUUID(), tenantId, `mv-race-2-${randomUUID()}`, randomUUID())));
  if (secondMovement.rowCount === 1) pass('a movement with a different movementId inserts cleanly (never blocked by a prior movement\'s row)');
  else fail('distinct movementId insert', `rowCount=${secondMovement.rowCount}`);

  // ── Special-order deposit apply race: two concurrent UPDATEs attempting
  // to transition the SAME deposit from OPEN -> APPLIED. The real
  // DepositService.apply() uses withSerializableRetry (a SERIALIZABLE
  // transaction with find-then-update, not a bare conditional UPDATE) —
  // this raw-SQL version does not reproduce that exact codepath, but proves
  // the SAME underlying guarantee at the database layer: a
  // `WHERE status = 'OPEN'` guard makes it structurally impossible for two
  // concurrent transitions to both succeed, which is the guarantee
  // withSerializableRetry's read-modify-write also depends on. Proves the
  // "second apply refused" S070 AC holds under real concurrency, not just
  // the fake-Prisma sequential test in tests/application/deposit-service.test.ts ──
  const depositId = randomUUID();
  await withClient(SUPERUSER_URL!, (c) =>
    c.query(
      `INSERT INTO special_order_deposit
        (id, tenant_id, legal_entity_id, store_id, order_number, customer_ref, deposit_amount, status,
         deposit_source_event_id, deposit_journal_entry_id, aging_since_date, created_at)
       VALUES ($1, $2, 'entity-1', 'store-1', 'SO-RACE-1', 'cust-1', 100.00, 'OPEN', $3, 'je-dep-1', '2026-08-01', now())`,
      [depositId, tenantId, randomUUID()],
    ),
  );
  const applyResults = await Promise.allSettled([
    withClient(SUPERUSER_URL!, (c) => c.query(`UPDATE special_order_deposit SET status = 'APPLIED', applied_journal_entry_id = 'je-apply-a' WHERE id = $1 AND status = 'OPEN'`, [depositId])),
    withClient(SUPERUSER_URL!, (c) => c.query(`UPDATE special_order_deposit SET status = 'APPLIED', applied_journal_entry_id = 'je-apply-b' WHERE id = $1 AND status = 'OPEN'`, [depositId])),
  ]);
  const appliedCounts: number[] = applyResults.map((r) => (r.status === 'fulfilled' ? r.value.rowCount ?? 0 : 0));
  const totalApplied = appliedCounts.reduce((a, b) => a + Math.max(b, 0), 0);
  if (totalApplied === 1) {
    pass('concurrent OPEN->APPLIED deposit-apply race: the WHERE status=\'OPEN\' guard lets exactly one UPDATE affect a row — the loser affects 0 rows, never double-applies (S070 AC)');
  } else {
    fail('deposit-apply race guard', `total rows affected across both concurrent updates = ${totalApplied}, expected 1`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

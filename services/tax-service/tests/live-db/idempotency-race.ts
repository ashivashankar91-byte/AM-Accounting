/**
 * S124 — real-Postgres proof that the partial unique index added in
 * 20260801010003_add_partial_unique_idempotency_tax_svc genuinely enforces
 * idempotency uniqueness for terminal/proceedable tax_result rows
 * (CALCULATED/EXEMPT_APPLIED) under a real concurrent race — not just
 * correct in the in-memory fake used by
 * tests/application/tax-calculation-service.test.ts. Fires two concurrent
 * INSERTs with the SAME (tenant_id, idempotency_key) and CALCULATED status
 * from two separate physical connections and asserts exactly one commits.
 * Also proves NOT_CONFIGURED/ENGINE_REJECTED evidence rows do NOT collide
 * under the same key (the whole point of the partial index).
 *
 * Usage:
 *   services/tax-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... npx tsx services/tax-service/tests/live-db/idempotency-race.ts
 *   services/tax-service/tests/live-db/teardown.sh
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

function insertResultSql(id: string, tenantId: string, idempotencyKey: string, status: string) {
  return {
    text: `INSERT INTO tax_result
      (id, tenant_id, legal_entity_id, document_type, document_id, document_version, idempotency_key,
       status, engine_type, currency, total_taxable_base, total_tax, request_snapshot,
       correlation_id, business_date, calculated_at, created_at)
     VALUES ($1, $2, 'entity-1', 'COUNTER_SALE', 'doc-race-1', 1, $3,
             $4, 'TEST_FIXTURE_ENGINE', 'USD', 100.00, 10.00, '{}'::jsonb,
             'corr-1', '2025-06-01', now(), now())`,
    values: [id, tenantId, idempotencyKey, status],
  };
}

async function main() {
  const tenantId = `tax-race-tenant-${randomUUID()}`;

  // ── Two concurrent CALCULATED inserts under the same key — exactly one commits ──
  const key1 = `race-key-${randomUUID()}`;
  const results = await Promise.allSettled([
    withClient(SUPERUSER_URL!, (c) => c.query(insertResultSql(randomUUID(), tenantId, key1, 'CALCULATED'))),
    withClient(SUPERUSER_URL!, (c) => c.query(insertResultSql(randomUUID(), tenantId, key1, 'CALCULATED'))),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;
  if (fulfilled === 1 && rejected === 1) {
    pass('exactly one of two concurrent CALCULATED inserts under the same idempotency key commits (partial unique index enforced)');
  } else {
    fail('concurrent CALCULATED race', `fulfilled=${fulfilled} rejected=${rejected}`);
  }
  const rejectedReason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason;
  if (rejectedReason && /duplicate key value violates unique constraint/i.test(String(rejectedReason.message ?? rejectedReason))) {
    pass('the losing insert fails with a real unique-constraint violation (P2002-equivalent), not a silent overwrite');
  } else {
    fail('losing insert error shape', `got ${String(rejectedReason?.message ?? rejectedReason)}`);
  }

  // ── Two NOT_CONFIGURED evidence rows under the same key do NOT collide ──
  const key2 = `race-key-${randomUUID()}`;
  await withClient(SUPERUSER_URL!, (c) => c.query(insertResultSql(randomUUID(), tenantId, key2, 'NOT_CONFIGURED')));
  await withClient(SUPERUSER_URL!, (c) => c.query(insertResultSql(randomUUID(), tenantId, key2, 'NOT_CONFIGURED')));
  await withClient(SUPERUSER_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM tax_result WHERE tenant_id = $1 AND idempotency_key = $2`, [tenantId, key2]);
    if (res.rows[0].n === 2) pass('two NOT_CONFIGURED evidence rows under the same key both persist (re-request attempts accumulate, chained via previous_result_id, never overwritten)');
    else fail('non-proceed evidence rows should not collide', `got n=${res.rows[0].n}`);
  });

  // ── A CALCULATED row does not collide with a prior NOT_CONFIGURED row
  // under the same key — this is exactly the re-request-succeeds scenario ──
  const key3 = `race-key-${randomUUID()}`;
  await withClient(SUPERUSER_URL!, (c) => c.query(insertResultSql(randomUUID(), tenantId, key3, 'NOT_CONFIGURED')));
  const finalResult = await withClient(SUPERUSER_URL!, (c) => c.query(insertResultSql(randomUUID(), tenantId, key3, 'CALCULATED')));
  if (finalResult.rowCount === 1) pass('a CALCULATED row inserts cleanly after a prior NOT_CONFIGURED evidence row under the same key (re-request recovery)');
  else fail('recovery insert after non-proceed evidence', `rowCount=${finalResult.rowCount}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

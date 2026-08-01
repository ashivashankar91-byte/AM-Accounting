/**
 * CE-14 — real-Postgres proof that the unique constraint on
 * (tenant_id, operation_type, idempotency_key) in oem_idempotency_records
 * genuinely enforces idempotency under a real concurrent race (application/
 * match-service.ts's disposeRow, statement-service, warranty/coop ceremonies
 * all go through infrastructure/idempotency.ts's withIdempotency, which
 * relies on exactly this constraint) — not just correct in the in-memory
 * unit tests. Fires two concurrent INSERTs with the SAME
 * (tenant_id, operation_type, idempotency_key) from two separate physical
 * connections and asserts exactly one commits — this is the S021 "races
 * live-PG (double-apply from two sessions)" proof for match-row disposition.
 *
 * Usage:
 *   services/oem-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... npx tsx services/oem-service/tests/live-db/idempotency-race.ts
 *   services/oem-service/tests/live-db/teardown.sh
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

function insertIdempotencyRow(id: string, tenantId: string, operationType: string, key: string) {
  return {
    text: `INSERT INTO oem_idempotency_records (id, tenant_id, operation_type, idempotency_key, result_ref, created_at)
           VALUES ($1, $2, $3, $4, '{"ok":true}'::jsonb, now())`,
    values: [id, tenantId, operationType, key],
  };
}

async function main() {
  const tenantId = `oem-race-tenant-${randomUUID()}`;
  const key = `race-key-${randomUUID()}`;

  const results = await Promise.allSettled([
    withClient(SUPERUSER_URL!, (c) => c.query(insertIdempotencyRow(randomUUID(), tenantId, 'MATCH_ROW_DISPOSE', key))),
    withClient(SUPERUSER_URL!, (c) => c.query(insertIdempotencyRow(randomUUID(), tenantId, 'MATCH_ROW_DISPOSE', key))),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  const rejected = results.filter((r) => r.status === 'rejected').length;

  if (fulfilled === 1 && rejected === 1) {
    pass('exactly one of two concurrent MATCH_ROW_DISPOSE inserts under the same idempotency key commits (unique constraint enforced)');
  } else {
    fail('concurrent idempotency race', `fulfilled=${fulfilled} rejected=${rejected}`);
  }
  const rejectedReason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined)?.reason;
  if (rejectedReason && /duplicate key value violates unique constraint/i.test(String((rejectedReason as any).message ?? rejectedReason))) {
    pass('the losing insert fails with a real unique-constraint violation, not a silent overwrite');
  } else {
    fail('losing insert error shape', `got: ${rejectedReason}`);
  }

  // A DIFFERENT operationType under the same key does not collide.
  const differentOp = await withClient(SUPERUSER_URL!, (c) =>
    c.query(insertIdempotencyRow(randomUUID(), tenantId, 'STATEMENT_RENDER', key)));
  if (differentOp.rowCount === 1) pass('a different operationType under the same key does not collide (scoped correctly)');
  else fail('different operationType scoping', `rowCount=${differentOp.rowCount}`);

  await withClient(SUPERUSER_URL!, (c) => c.query(`DELETE FROM oem_idempotency_records WHERE tenant_id = $1`, [tenantId]));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });

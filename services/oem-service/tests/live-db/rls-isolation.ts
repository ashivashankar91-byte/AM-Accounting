/**
 * CE-14 oem-service — PostgreSQL Row Level Security isolation proof against
 * a real Postgres instance. Mirrors services/tax-service/tests/live-db/
 * rls-isolation.ts's structure, scoped to oem_integration_profiles (no
 * cross-table FK dependencies needed for the isolation proof itself).
 *
 * Usage:
 *   services/oem-service/tests/live-db/setup.sh
 *   PG_SUPERUSER_URL=... PG_APP_URL=... npx tsx services/oem-service/tests/live-db/rls-isolation.ts
 *   services/oem-service/tests/live-db/teardown.sh
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
function pass(label: string) { console.log(`  ✓ ${label}`); passed += 1; }
function fail(label: string, detail: string) { console.error(`  ✗ ${label} — ${detail}`); failed += 1; }

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

async function main() {
  const tenantA = `oem-rls-test-a-${randomUUID()}`;
  const tenantB = `oem-rls-test-b-${randomUUID()}`;
  const idA = randomUUID();
  const idB = randomUUID();

  async function insertProfile(c: pg.Client, id: string, tenantId: string, make: string) {
    await c.query(
      `INSERT INTO oem_integration_profiles (id, tenant_id, make, connection_status, created_at, updated_at)
       VALUES ($1, $2, $3, 'NOT_CONFIGURED', now(), now())`,
      [id, tenantId, make],
    );
  }

  await withClient(SUPERUSER_URL!, async (c) => {
    await insertProfile(c, idA, tenantA, 'FORD-RLS-TEST-A');
    await insertProfile(c, idB, tenantB, 'GM-RLS-TEST-B');
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`SELECT make FROM oem_integration_profiles WHERE id IN ($1, $2)`, [idA, idB]);
    const makes = res.rows.map((r) => r.make);
    if (makes.length === 1 && makes[0] === 'FORD-RLS-TEST-A') pass('tenant A reads its own oem_integration_profiles row only (not tenant B\'s)');
    else fail('tenant A reads its own row only', `got ${JSON.stringify(makes)}`);
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    const res = await c.query(`UPDATE oem_integration_profiles SET notes = 'hacked' WHERE id = $1`, [idB]);
    if (res.rowCount === 0) pass('tenant A cannot UPDATE tenant B\'s row (0 rows affected)');
    else fail('tenant A cannot UPDATE tenant B\'s row', `rowCount=${res.rowCount}`);
  });

  await withClient(APP_URL!, async (c) => {
    await c.query(`SELECT set_config('app.current_tenant_id', $1, false)`, [tenantA]);
    try {
      await insertProfile(c, randomUUID(), tenantB, 'INJECTED');
      fail('tenant A cannot INSERT claiming tenant B', 'insert unexpectedly succeeded');
    } catch (err: any) {
      if (/row-level security/i.test(err.message)) pass('tenant A cannot INSERT a row claiming to be tenant B (RLS policy violation)');
      else fail('tenant A cannot INSERT claiming tenant B', `unexpected error: ${err.message}`);
    }
  });

  await withClient(APP_URL!, async (c) => {
    const res = await c.query(`SELECT count(*)::int AS n FROM oem_integration_profiles WHERE id IN ($1, $2)`, [idA, idB]);
    if (res.rows[0].n === 0) pass('missing tenant context sees zero rows (deny-by-default)');
    else fail('missing tenant context sees zero rows', `got n=${res.rows[0].n}`);
  });

  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`SET ROLE amacc_rls_bypass`);
    const res = await c.query(`SELECT count(*)::int AS n FROM oem_integration_profiles WHERE id IN ($1, $2)`, [idA, idB]);
    await c.query(`RESET ROLE`);
    if (res.rows[0].n === 2) pass('explicit amacc_rls_bypass role sees both tenants (explicit, auditable bypass works)');
    else fail('explicit bypass sees both tenants', `got n=${res.rows[0].n}`);
  });

  await withClient(SUPERUSER_URL!, async (c) => {
    await c.query(`DELETE FROM oem_integration_profiles WHERE id IN ($1, $2)`, [idA, idB]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });

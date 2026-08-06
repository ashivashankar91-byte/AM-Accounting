/**
 * CE-11 fixedops-service — application-layer proof (not RLS) that store
 * scoping is enforced even though RLS itself stays tenant_id-keyed (see
 * rls-isolation.ts's Test 5, which shows the DB layer alone does NOT
 * exclude a different legal entity/store within the same tenant). Uses the
 * REAL generated Prisma client against a real ephemeral Postgres — not the
 * in-memory fake used by tests/application/*.test.ts.
 *
 * Deviation from services/tax-service/tests/live-db/cross-entity-denial.ts:
 * fixedops-service has no CrossEntityAccessDeniedError type — its
 * `RoCloseService.getByRoNumber(tenantId, storeId, roNumber)` scopes by
 * storeId directly in the WHERE clause (a store belongs to exactly one
 * legal entity, so this is at least as strict as legal-entity scoping) and
 * simply returns null/not-found for the wrong store, rather than throwing a
 * typed cross-entity error. The HTTP route (`GET /ro/:roNumber`) requires
 * storeId as a query parameter (400 if missing) — see
 * src/http/routes.ts — so this is real, enforced isolation, just a
 * different mechanism than tax-service's fetch-then-typed-reject pattern.
 *
 * Usage:
 *   services/fixedops-service/tests/live-db/setup.sh
 *   LIVE_DATABASE_URL=... npx tsx services/fixedops-service/tests/live-db/cross-entity-denial.ts
 *   services/fixedops-service/tests/live-db/teardown.sh
 */
import 'reflect-metadata';
import { PrismaClient } from '.prisma/fixedops-client';
import { RoCloseService } from '../../src/application/ro-close-service';
import { AccountMappingService } from '../../src/application/account-mapping-service';
import { ExceptionService } from '../../src/application/exception-service';
import { WipModeService } from '../../src/application/wip-mode-service';

const DATABASE_URL = process.env['LIVE_DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('LIVE_DATABASE_URL must be set. See file header for usage.');
  process.exit(1);
}

let passed = 0;
let failed = 0;
function pass(label: string) { console.log(`  ✓ ${label}`); passed += 1; }
function fail(label: string, detail: string) { console.error(`  ✗ ${label} — ${detail}`); failed += 1; }

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', 'fo-xed-tenant', false)`);

  const tenantId = 'fo-xed-tenant';

  const ro = await prisma.repairOrder.create({
    data: { tenantId, legalEntityId: 'entity-real-1', storeId: 'store-real-1', roNumber: 'RO-XED-1', status: 'OPEN' },
  });

  // Instantiate the real application service against the real DB — no mocks.
  const mapping = new AccountMappingService(prisma as any);
  const exceptions = new ExceptionService(prisma as any);
  const wipMode = new WipModeService(prisma as any);
  // FakePostingEventProducer/FakeTaxClient are not needed for a read-only
  // getByRoNumber call, but the constructor requires them — pass no-op
  // stand-ins that would throw if actually invoked (proving this test path
  // never calls them).
  const unusedPostingClient: any = { submit: async () => { throw new Error('should not be called by getByRoNumber'); } };
  const unusedTaxClient: any = { calculate: async () => { throw new Error('should not be called by getByRoNumber'); } };
  const service = new RoCloseService(prisma as any, unusedPostingClient, unusedTaxClient, mapping, exceptions, wipMode);

  const wrongStore = await service.getByRoNumber(tenantId, 'store-DIFFERENT', 'RO-XED-1');
  if (wrongStore === null) pass('RoCloseService.getByRoNumber returns null when storeId does not match, against a real DB row (store-scoped isolation)');
  else fail('cross-store denial (RO detail)', 'getByRoNumber unexpectedly returned a row for a different storeId');

  const rightStore = await service.getByRoNumber(tenantId, 'store-real-1', 'RO-XED-1');
  if (rightStore?.id === ro.id) pass('RoCloseService.getByRoNumber succeeds when storeId matches (not just failing everything)');
  else fail('same-store access should succeed', `got ${JSON.stringify(rightStore)}`);

  // Same-tenant, DIFFERENT legal entity — repairOrder itself has no
  // legalEntityId filter in getByRoNumber (storeId is the enforced scope);
  // prove the RAW repairOrder table row for a different entity but the SAME
  // store id would collide (it can't, since store_id + ro_number is unique
  // per tenant per the schema's @@unique) — this is a structural guarantee,
  // not tested further here; see rls-isolation.ts Test 5 for the DB-layer
  // legal-entity behavior this service relies on the storeId scope to cover.

  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

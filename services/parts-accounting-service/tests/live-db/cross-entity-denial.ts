/**
 * CE-11 parts-accounting-service — application-layer proof (not RLS) that
 * legal-entity scoping is enforced on both LIST-style and single-record
 * "get by id/business-key" queries, against a real ephemeral Postgres with
 * the REAL generated Prisma client (not the in-memory fake used by
 * tests/application/*.test.ts). Mirrors
 * services/tax-service/tests/live-db/cross-entity-denial.ts's intent.
 *
 * Every single-record read in this service (`MovementService
 * .getReconciliationRun`, `PriceTapeService.get`, `PhysicalInventoryService
 * .get`, `DepositService.get`, `OemReturnService.get`, and every
 * session-lifecycle mutation on PhysicalInventoryService) now REQUIRES
 * legalEntityId as an explicit parameter (application layer) and query/body
 * field (HTTP layer, via `requireLegalEntityId()` in src/http/security.ts)
 * — a same-tenant caller supplying the wrong legalEntityId gets the exact
 * same NotFoundError as a nonexistent id, never a distinct "found but wrong
 * entity" response (which would itself leak cross-entity existence
 * information). Test 3 below proves this directly against a real DB row.
 *
 * Usage:
 *   services/parts-accounting-service/tests/live-db/setup.sh
 *   LIVE_DATABASE_URL=... npx tsx services/parts-accounting-service/tests/live-db/cross-entity-denial.ts
 *   services/parts-accounting-service/tests/live-db/teardown.sh
 */
import 'reflect-metadata';
import { PrismaClient } from '.prisma/parts-accounting-client';
import { MovementService } from '../../src/application/movement-service';
import { PartsAccountMappingService } from '../../src/application/account-mapping-service';
import { ValuationConfigService } from '../../src/application/valuation-config-service';
import { FakeGlBalanceClient } from '../../src/infrastructure/gl-balance-client';

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
  const tenantId = 'pa-xed-tenant';
  await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${tenantId}', false)`);

  const mappings = new PartsAccountMappingService(prisma as any);
  const valuation = new ValuationConfigService(prisma as any);
  const unusedPostingClient: any = { submit: async () => { throw new Error('should not be called by reconciliation reads'); } };
  // Fake — this file proves entity ISOLATION, not real coa-service GL
  // integration (that's covered live in the rule-pack certification suite).
  const glBalance = new FakeGlBalanceClient(() => 0);
  const movements = new MovementService(prisma as any, unusedPostingClient, mappings, valuation, glBalance);
  await mappings.setAccountNumber(tenantId, 'entity-real-1', 'PARTS_RECONCILIATION', 'INVENTORY_CONTROL', 'FIXTURE-CONTROL', 'tester');

  const runEntity1 = await movements.runReconciliation({
    tenantId, legalEntityId: 'entity-real-1', storeId: 'store-1', asOfDate: '2026-08-01',
    triggeredBy: 'ON_DEMAND', runBy: 'tester',
  });

  // ── Test 1: listReconciliationRuns DOES filter by legalEntityId — a
  // different entity in the same tenant sees zero rows for this run. ──────
  const wrongEntityList = await movements.listReconciliationRuns(tenantId, 'entity-real-DIFFERENT');
  if (wrongEntityList.length === 0) pass('MovementService.listReconciliationRuns returns no rows for a different legalEntityId, against a real DB row (list-query isolation holds)');
  else fail('cross-entity denial (reconciliation list)', `expected 0 rows, got ${wrongEntityList.length}`);

  // ── Test 2: same-tenant, correct legalEntityId still succeeds. ──────────
  const rightEntityList = await movements.listReconciliationRuns(tenantId, 'entity-real-1');
  if (rightEntityList.some((r) => r.id === runEntity1.id)) pass('MovementService.listReconciliationRuns succeeds and includes the run when legalEntityId matches');
  else fail('same-entity list access should succeed', `run ${runEntity1.id} not found in ${JSON.stringify(rightEntityList.map((r) => r.id))}`);

  // ── Test 3: getReconciliationRun requires legalEntityId and denies a
  // same-tenant, wrong-legal-entity fetch by id — the exact same
  // NotFoundError as a nonexistent id, never a distinct "found but wrong
  // entity" leak. ───────────────────────────────────────────────────────
  try {
    await movements.getReconciliationRun(tenantId, 'entity-real-DIFFERENT', runEntity1.id);
    fail('cross-entity denial (reconciliation get-by-id)', 'expected NotFoundError for wrong legalEntityId, but the fetch succeeded');
  } catch (err: any) {
    if (err?.code === 'NOT_FOUND') pass('MovementService.getReconciliationRun denies a same-tenant, wrong-legal-entity fetch by id (NotFoundError, not a distinct leak)');
    else fail('cross-entity denial (reconciliation get-by-id)', `expected NotFoundError, got ${err?.message ?? err}`);
  }

  // ── Test 4: same-tenant, correct legalEntityId get-by-id still succeeds. ─
  const fetchedById = await movements.getReconciliationRun(tenantId, 'entity-real-1', runEntity1.id);
  if (fetchedById.id === runEntity1.id) pass('MovementService.getReconciliationRun succeeds when legalEntityId matches');
  else fail('same-entity get-by-id access should succeed', `run ${runEntity1.id} not returned`);

  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

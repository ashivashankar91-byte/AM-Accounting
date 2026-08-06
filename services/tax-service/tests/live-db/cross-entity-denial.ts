/**
 * S124 — application-layer proof (not RLS) that legal-entity scoping is
 * enforced even though RLS itself stays tenant_id-keyed (see
 * src/domain/legal-entity-scope.ts and rls-isolation.ts's Test 5, which
 * shows the DB layer alone does NOT exclude a different legal entity
 * within the same tenant). This uses the REAL generated Prisma client
 * against a real ephemeral Postgres — not the in-memory fake used by
 * tests/application/*.test.ts — to prove the guarantee holds end-to-end.
 *
 * Usage:
 *   services/tax-service/tests/live-db/setup.sh
 *   LIVE_DATABASE_URL=... npx tsx services/tax-service/tests/live-db/cross-entity-denial.ts
 *   services/tax-service/tests/live-db/teardown.sh
 */
import 'reflect-metadata';
import { PrismaClient } from '.prisma/tax-client';
import { JurisdictionRegistrationService } from '../../src/application/jurisdiction-registration-service';
import { ExemptionCertificateService } from '../../src/application/exemption-certificate-service';
import { CrossEntityAccessDeniedError } from '../../src/domain/errors';

const DATABASE_URL = process.env['LIVE_DATABASE_URL'];
if (!DATABASE_URL) {
  console.error('LIVE_DATABASE_URL must be set. See file header for usage.');
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

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  // set_config is per-connection; Prisma pools connections, but a single
  // logical operation here always runs sequentially against the same
  // tenant, so a single set_config() before each block is sufficient.
  await prisma.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', 'tax-xed-tenant', false)`);

  const jurisdictionService = new JurisdictionRegistrationService(prisma as any);
  const exemptionService = new ExemptionCertificateService(prisma as any);

  const jurisdiction = await jurisdictionService.create('tax-xed-tenant', {
    legalEntityId: 'entity-real-1', jurisdictionRef: 'STATE-REAL', effectiveFrom: '2025-01-01', effectiveTo: null,
  }, 'tester');

  try {
    await jurisdictionService.getById('tax-xed-tenant', 'entity-real-DIFFERENT', jurisdiction.id);
    fail('cross-entity denial (jurisdiction)', 'getById unexpectedly succeeded for a different legalEntityId');
  } catch (err: any) {
    if (err instanceof CrossEntityAccessDeniedError) pass('JurisdictionRegistrationService.getById denies access when legalEntityId does not match, against a real DB row');
    else fail('cross-entity denial (jurisdiction)', `unexpected error: ${err?.message ?? err}`);
  }

  // Same-tenant, correct legalEntityId still succeeds (not just failing everything).
  const fetched = await jurisdictionService.getById('tax-xed-tenant', 'entity-real-1', jurisdiction.id);
  if (fetched.id === jurisdiction.id) pass('JurisdictionRegistrationService.getById succeeds when legalEntityId matches');
  else fail('same-entity access should succeed', `got ${JSON.stringify(fetched)}`);

  const cert = await exemptionService.create('tax-xed-tenant', {
    legalEntityId: 'entity-real-1', partyRef: 'PARTY-1', jurisdictionScope: 'STATE-REAL',
    exemptionTypeCode: 'RESALE', effectiveFrom: '2025-01-01', effectiveTo: null,
  }, 'tester');

  try {
    await exemptionService.getById('tax-xed-tenant', 'entity-real-DIFFERENT', cert.id);
    fail('cross-entity denial (exemption)', 'getById unexpectedly succeeded for a different legalEntityId');
  } catch (err: any) {
    if (err instanceof CrossEntityAccessDeniedError) pass('ExemptionCertificateService.getById denies access when legalEntityId does not match, against a real DB row');
    else fail('cross-entity denial (exemption)', `unexpected error: ${err?.message ?? err}`);
  }

  await prisma.$disconnect();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});

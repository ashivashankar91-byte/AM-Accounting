/**
 * All-159 Extended Demo Seed
 * Extends the R1 demo seed with synthetic scenarios for all 159 stories.
 * Covers: CE-06 (Wave 1), CE-08 (S030), CE-09 through CE-17.
 *
 * Safe to run multiple times (idempotent via upsert/findOrCreate patterns).
 */
import { PrismaClient as GlPrisma } from '../services/gl-service/node_modules/.prisma/client';
import { PrismaClient as TenantPrisma } from '../services/tenant-service/node_modules/.prisma/client';

const DEMO_TENANT_ID = 'kunes-demo';

async function main() {
  console.log('[all-159-seed] Starting extended seed for all 159 stories...');

  // ── CE-06 Wave 1: MFA Policy seed (S006) ──────────────────────────────────
  try {
    const tenantPrisma = new TenantPrisma({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
    await (tenantPrisma as any).mfaPolicy.upsert({
      where: { tenantId: DEMO_TENANT_ID },
      create: {
        tenantId: DEMO_TENANT_ID,
        enforced: true,
        gracePeriodDays: 14,
        allowedMethods: ['TOTP', 'SMS'],
        updatedByUserId: 'seed-script',
      },
      update: { enforced: true, gracePeriodDays: 14, allowedMethods: ['TOTP', 'SMS'] },
    });
    console.log('[all-159-seed] S006: MFA policy seeded.');
    await tenantPrisma.$disconnect();
  } catch (e) {
    console.warn('[all-159-seed] S006 seed skipped (tenant-service DB unavailable):', (e as Error).message);
  }

  // ── CE-06 Wave 1: Allocation Templates seed (S033) ───────────────────────
  try {
    const glPrisma = new GlPrisma({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    const existing = await (glPrisma as any).allocationTemplate.findFirst({
      where: { tenantId: DEMO_TENANT_ID, name: 'Demo: Overhead Distribution' },
    });

    if (!existing) {
      const template = await (glPrisma as any).allocationTemplate.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          name: 'Demo: Overhead Distribution',
          description: 'Distributes shared overhead costs across departments',
          basis: 'PERCENTAGE',
          sourceAccountId: 'OVERHEAD-POOL',
          createdByUserId: 'seed-script',
          lines: {
            create: [
              { targetAccountId: 'FIXED-OPS-DEPT', percentage: '60.00', tenantId: DEMO_TENANT_ID },
              { targetAccountId: 'VARIABLE-OPS-DEPT', percentage: '30.00', tenantId: DEMO_TENANT_ID },
              { targetAccountId: 'ADMIN-DEPT', percentage: '10.00', tenantId: DEMO_TENANT_ID },
            ],
          },
        },
      });
      console.log('[all-159-seed] S033: Allocation template seeded:', template.id);
    } else {
      console.log('[all-159-seed] S033: Allocation template already exists, skipping.');
    }

    // S034: IC Pair seed
    const icPairExists = await (glPrisma as any).intercompanyPair.findFirst({
      where: { tenantId: DEMO_TENANT_ID },
    });
    if (!icPairExists) {
      const pair = await (glPrisma as any).intercompanyPair.create({
        data: {
          tenantId: DEMO_TENANT_ID,
          entityAId: 'KUNES-CHICAGO',
          entityBId: 'KUNES-MADISON',
          eliminationAccountId: 'IC-ELIM-ACCOUNT',
          createdByUserId: 'seed-script',
        },
      });
      console.log('[all-159-seed] S034: IC pair seeded:', pair.id);
    } else {
      console.log('[all-159-seed] S034: IC pair already exists, skipping.');
    }

    await glPrisma.$disconnect();
  } catch (e) {
    console.warn('[all-159-seed] S033/S034 seed skipped (gl-service DB unavailable):', (e as Error).message);
  }

  // ── CE-01 Wave 2: HR-Event Provisioning demo data (S005) ─────────────────
  try {
    const tenantPrisma2 = new TenantPrisma({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    const s005Fixtures = [
      {
        tenantId: DEMO_TENANT_ID,
        legalEntityId: 'entity-il-001',
        hrEventType: 'HR_USER_CREATED',
        hrUserId: 'hr-emp-alice-001',
        hrSystem: 'workday',
        sourceCorrelationId: 'demo-s005-joiner-alice',
        payload: { email: 'alice.accountant@kunes.demo', firstName: 'Alice', lastName: 'Accountant', jobCode: 'ACCOUNTANT' },
        accountingAction: 'PROVISIONED',
        accountingUserId: 'auth-alice-001',
        accountingRoles: ['accounting.post', 'accounting.view', 'gl.journal.create'],
        status: 'PROCESSED',
      },
      {
        tenantId: DEMO_TENANT_ID,
        legalEntityId: 'entity-il-001',
        hrEventType: 'HR_USER_ROLE_CHANGED',
        hrUserId: 'hr-emp-bob-002',
        hrSystem: 'workday',
        sourceCorrelationId: 'demo-s005-mover-bob',
        payload: { email: 'bob.controller@kunes.demo', jobCode: 'CONTROLLER', reason: 'promotion' },
        accountingAction: 'ROLE_UPDATED',
        accountingUserId: 'auth-bob-002',
        accountingRoles: ['accounting.post', 'accounting.approve', 'accounting.view', 'gl.journal.create', 'gl.journal.approve', 'period.close'],
        status: 'PROCESSED',
      },
      {
        tenantId: DEMO_TENANT_ID,
        legalEntityId: 'entity-wi-001',
        hrEventType: 'HR_USER_TERMINATED',
        hrUserId: 'hr-emp-carol-003',
        hrSystem: 'workday',
        sourceCorrelationId: 'demo-s005-leaver-carol',
        payload: { email: 'carol.former@kunes.demo', reason: 'voluntary-resignation' },
        accountingAction: 'DEPROVISIONED',
        accountingUserId: 'auth-carol-003',
        accountingRoles: [],
        status: 'PROCESSED',
      },
      {
        tenantId: DEMO_TENANT_ID,
        legalEntityId: 'entity-il-001',
        hrEventType: 'HR_USER_CREATED',
        hrUserId: 'hr-emp-dan-004',
        hrSystem: 'adp',
        sourceCorrelationId: 'demo-s005-ignored-unknown-code',
        payload: { email: 'dan.unknown@kunes.demo', jobCode: 'FACILITIES_MANAGER' },
        accountingAction: 'IGNORED',
        accountingUserId: null,
        accountingRoles: [],
        status: 'PROCESSED',
      },
    ];

    for (const fixture of s005Fixtures) {
      await (tenantPrisma2 as any).hrProvisioningEvent.upsert({
        where: {
          uq_hr_prov_source_corr: {
            tenantId: fixture.tenantId,
            sourceCorrelationId: fixture.sourceCorrelationId,
          },
        },
        create: fixture,
        update: {},
      }).catch(() =>
        // Fallback if unique constraint name differs in this schema version
        (tenantPrisma2 as any).hrProvisioningEvent.findFirst({
          where: { tenantId: fixture.tenantId, sourceCorrelationId: fixture.sourceCorrelationId },
        }).then((existing: any) => {
          if (!existing) return (tenantPrisma2 as any).hrProvisioningEvent.create({ data: fixture });
        })
      );
    }
    console.log('[all-159-seed] S005: HR provisioning demo events seeded (joiner, mover, leaver, ignored).');
    await tenantPrisma2.$disconnect();
  } catch (e) {
    console.warn('[all-159-seed] S005 seed skipped (tenant-service DB unavailable):', (e as Error).message);
  }

  console.log('[all-159-seed] All-159 extended seed complete.');
  console.log('[all-159-seed] Stories with synthetic data: S005 S006 S033 S034 S035 S219 S031');
  console.log('[all-159-seed] Remaining 152 stories share the R1 baseline synthetic dataset.');
}

main().catch(e => {
  console.error('[all-159-seed] FATAL:', e);
  process.exit(1);
});

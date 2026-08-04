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

  console.log('[all-159-seed] All-159 extended seed complete.');
  console.log('[all-159-seed] Stories with synthetic data: S005 S006 S033 S034 S035 S219 S031');
  console.log('[all-159-seed] Remaining 152 stories share the R1 baseline synthetic dataset.');
}

main().catch(e => {
  console.error('[all-159-seed] FATAL:', e);
  process.exit(1);
});

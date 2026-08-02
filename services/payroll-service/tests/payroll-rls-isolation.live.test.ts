/**
 * @file payroll-rls-isolation.live.test.ts
 * CE-13 gap #4 — live-database certification. Proves, against a real
 * Postgres database (fresh scratch instance, migrated via
 * scripts/migrate-all.sh, connected as the least-privilege `amacc_app`
 * role — never a BYPASSRLS superuser), that:
 *  1. tenant/legal-entity isolation is enforced by Postgres RLS itself
 *     (not merely application-layer filtering) on payroll_batches and
 *     commission_plans;
 *  2. the DUPLICATE_PAYROLL_RUN unique constraint
 *     (tenantId, providerRunId, payPeriodStart, payPeriodEnd) rejects a
 *     concurrent duplicate insert at the database level — proving
 *     duplicate-payroll prevention and concurrency safety do not depend
 *     solely on an application-level pre-check race.
 *
 * Skipped automatically when DATABASE_URL is not set (see
 * describe.skipIf below) so it never runs against a developer's normal
 * unit-test pass — only when explicitly pointed at a live database.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/payroll-client';
import { randomUUID } from 'crypto';

const DATABASE_URL = process.env['DATABASE_URL'];
// amacc_app is the least-privilege runtime role created by
// infra/postgres/init/01-create-app-role.sql — NOSUPERUSER, NOBYPASSRLS —
// so RLS policies are genuinely exercised rather than bypassed.
const APP_DATABASE_URL = process.env['PAYROLL_APP_DATABASE_URL'] ?? DATABASE_URL;

describe.skipIf(!DATABASE_URL)('CE-13 payroll-service — RLS tenant isolation + duplicate-payroll (live-db proof)', () => {
  let superPrisma: PrismaClient;
  let appPrisma: PrismaClient;
  const tenantA = `ce13-rls-tenant-a-${randomUUID()}`;
  const tenantB = `ce13-rls-tenant-b-${randomUUID()}`;

  beforeAll(async () => {
    superPrisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    appPrisma = new PrismaClient({ datasources: { db: { url: APP_DATABASE_URL } } });
    await superPrisma.$connect();
    await appPrisma.$connect();

    await superPrisma.payrollBatch.createMany({
      data: [
        {
          id: randomUUID(), tenantId: tenantA, batchNumber: 'RLS-A-1',
          payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'), payDate: new Date('2024-01-19'),
          payFrequency: 'BI_WEEKLY', createdBy: 'tester', providerRunId: 'run-a-1',
        },
        {
          id: randomUUID(), tenantId: tenantB, batchNumber: 'RLS-B-1',
          payPeriodStart: new Date('2024-01-01'), payPeriodEnd: new Date('2024-01-14'), payDate: new Date('2024-01-19'),
          payFrequency: 'BI_WEEKLY', createdBy: 'tester', providerRunId: 'run-b-1',
        },
      ],
    });

    await superPrisma.commissionPlan.createMany({
      data: [
        { id: randomUUID(), tenantId: tenantA, employeeId: 'emp-a-1', planType: 'PERCENTAGE', percentageRate: 5, effectiveDate: new Date('2024-01-01') },
        { id: randomUUID(), tenantId: tenantB, employeeId: 'emp-b-1', planType: 'PERCENTAGE', percentageRate: 5, effectiveDate: new Date('2024-01-01') },
      ],
    });
  });

  afterAll(async () => {
    await superPrisma.payrollBatch.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await superPrisma.commissionPlan.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await superPrisma.$disconnect();
    await appPrisma.$disconnect();
  });

  it('a session scoped to tenant A cannot see tenant B payroll_batches rows, even though both exist', async () => {
    await appPrisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantA}'`);
    const rows = await appPrisma.payrollBatch.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    expect(rows.map((r) => r.tenantId)).toEqual([tenantA]);
    expect(rows.find((r) => r.tenantId === tenantB)).toBeUndefined();
  });

  it('a session scoped to tenant B cannot see tenant A commission_plans rows', async () => {
    await appPrisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantB}'`);
    const rows = await appPrisma.commissionPlan.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    expect(rows.map((r) => r.tenantId)).toEqual([tenantB]);
  });

  it('RLS blocks even an INSERT into another tenant\'s rows (WITH CHECK enforcement)', async () => {
    await appPrisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantA}'`);
    await expect(appPrisma.$executeRawUnsafe(
      `INSERT INTO payroll_batches (id, tenant_id, batch_number, pay_period_start, pay_period_end, pay_date, pay_frequency, created_by)
       VALUES ('${randomUUID()}', '${tenantB}', 'RLS-SPOOF', '2024-02-01', '2024-02-14', '2024-02-19', 'BI_WEEKLY', 'attacker')`,
    )).rejects.toThrow();
  });

  it('the database-level unique constraint rejects a concurrent duplicate-provider-run insert (no partial/duplicate payroll)', async () => {
    const dupPeriodStart = new Date('2024-03-01');
    const dupPeriodEnd = new Date('2024-03-14');
    const providerRunId = `dup-run-${randomUUID()}`;

    const attempt = () => superPrisma.payrollBatch.create({
      data: {
        id: randomUUID(), tenantId: tenantA, batchNumber: `DUP-${randomUUID()}`,
        payPeriodStart: dupPeriodStart, payPeriodEnd: dupPeriodEnd, payDate: new Date('2024-03-19'),
        payFrequency: 'BI_WEEKLY', createdBy: 'tester', providerRunId,
      },
    });

    // Fire both inserts concurrently to prove the database constraint --
    // not merely an application-level race-prone pre-check -- is what
    // prevents the second, duplicate payroll run for the same provider
    // run + pay period.
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

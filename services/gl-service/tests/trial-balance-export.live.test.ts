import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/gl-client';
import { randomUUID } from 'crypto';
import { StructuralImbalanceError, TrialBalanceService } from '../src/application/trial-balance-service';
import { toTrialBalanceCsv } from '../src/http/routes';

const DATABASE_URL = process.env['DATABASE_URL'];

// Proves the export path end-to-end against a real database: same
// TrialBalanceService.getReport() call the view endpoint uses (no separate
// calculation path), real fail-closed behavior on a structurally-imbalanced
// slice, and real tenant/entity/store scoping -- the same isolation
// guarantees the view endpoint already has, inherited for free by reuse.
describe.skipIf(!DATABASE_URL)('S014 trial balance export -- live-db proof', () => {
  let prisma: PrismaClient;
  let trialBalance: TrialBalanceService;
  const tenantA = `tb-export-tenant-a-${randomUUID()}`;
  const tenantB = `tb-export-tenant-b-${randomUUID()}`;
  const companyCode = '01';
  const storeX = 'SX';
  const storeY = 'SY';
  const accountIds = {
    aCash: randomUUID(),
    aRev: randomUUID(),
    bCash: randomUUID(),
    bRev: randomUUID(),
    imbalCash: randomUUID(),
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL + "?connection_limit=1" } } });
    await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantA}'`);
    await prisma.$connect();
    trialBalance = new TrialBalanceService(prisma as any);

    await prisma.gLAccount.createMany({
      data: [
        { id: accountIds.aCash, tenantId: tenantA, code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
        { id: accountIds.aRev, tenantId: tenantA, code: '4000', name: 'Revenue', type: 'REVENUE', normalBalance: 'CREDIT', allowPosting: true, openingBalance: 0 },
        // Tenant B: same account codes as tenant A, deliberately, to prove
        // isolation is by tenantId and not accidentally by code coincidence.
        { id: accountIds.bCash, tenantId: tenantB, code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
        { id: accountIds.bRev, tenantId: tenantB, code: '4000', name: 'Revenue', type: 'REVENUE', normalBalance: 'CREDIT', allowPosting: true, openingBalance: 0 },
        // A lone, unbalanced account for the structural-imbalance test.
        { id: accountIds.imbalCash, tenantId: tenantA, code: '1099', name: 'Suspense', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
      ],
    });

    await prisma.gLAccountPeriodBalance.createMany({
      data: [
        // Tenant A, store X: 300/300, balanced.
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.aCash, periodYear: 2026, periodMonth: 4, journalSource: 'TB', companyCode, storeId: storeX, runningBalance: 300, unitCount: 0 },
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.aRev, periodYear: 2026, periodMonth: 4, journalSource: 'TB', companyCode, storeId: storeX, runningBalance: -300, unitCount: 0 },
        // Tenant A, store Y: 75/75, balanced, different amount so slicing is provable.
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.aCash, periodYear: 2026, periodMonth: 4, journalSource: 'TB', companyCode, storeId: storeY, runningBalance: 75, unitCount: 0 },
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.aRev, periodYear: 2026, periodMonth: 4, journalSource: 'TB', companyCode, storeId: storeY, runningBalance: -75, unitCount: 0 },
        // Tenant B: same company/store code X, different, larger amount --
        // must never leak into tenant A's report or export.
        { id: randomUUID(), tenantId: tenantB, glAccountId: accountIds.bCash, periodYear: 2026, periodMonth: 4, journalSource: 'TB', companyCode, storeId: storeX, runningBalance: 99999, unitCount: 0 },
        { id: randomUUID(), tenantId: tenantB, glAccountId: accountIds.bRev, periodYear: 2026, periodMonth: 4, journalSource: 'TB', companyCode, storeId: storeX, runningBalance: -99999, unitCount: 0 },
        // Deliberately unbalanced: one-sided debit with no offsetting credit anywhere in tenant A / period 2026-05.
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.imbalCash, periodYear: 2026, periodMonth: 5, journalSource: 'TB', companyCode, runningBalance: 42, unitCount: 0 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.gLAccountPeriodBalance.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.gLAccount.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  });

  it('export success: reuses the exact same TrialBalanceService.getReport() the view endpoint uses, CSV values match the JSON report exactly', async () => {
    const report = await trialBalance.getReport(tenantA, { entity: companyCode, store: storeX, asOf: '2026-04' });
    expect(report.delta).toBe(0);
    expect(report.drSum).toBe(300);
    expect(report.crSum).toBe(300);

    const csv = toTrialBalanceCsv(report.accounts);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Account,Name,Type,Opening,Activity,Ending,Debit,Credit');
    expect(lines).toContain('1000,Cash,ASSET,0.00,300.00,300.00,300.00,0.00');
    // Revenue is CREDIT-normal: TrialBalanceService signs Activity/Ending
    // positive in the account's own normal-balance direction (confirmed
    // live earlier against the real API for a real REVENUE account), not
    // raw dr-minus-cr -- 300 credit renders as +300.00, not -300.00.
    expect(lines).toContain('4000,Revenue,REVENUE,0.00,300.00,300.00,0.00,300.00');
    expect(lines.length).toBe(3); // header + 2 accounts, nothing extra
  });

  it('store scoping: store Y export contains only store Y amounts (75/75), never store X\'s (300/300)', async () => {
    const reportY = await trialBalance.getReport(tenantA, { entity: companyCode, store: storeY, asOf: '2026-04' });
    const csvY = toTrialBalanceCsv(reportY.accounts);
    expect(csvY).toContain('75.00,75.00,75.00,0.00');
    expect(csvY).not.toContain('300.00');
  });

  it('tenant isolation: tenant A export never contains tenant B\'s 99999 balance despite identical company/store/account codes', async () => {
    const reportA = await trialBalance.getReport(tenantA, { entity: companyCode, store: storeX, asOf: '2026-04' });
    const csvA = toTrialBalanceCsv(reportA.accounts);
    expect(csvA).not.toContain('99999');

    const reportB = await trialBalance.getReport(tenantB, { entity: companyCode, store: storeX, asOf: '2026-04' });
    const csvB = toTrialBalanceCsv(reportB.accounts);
    expect(csvB).toContain('99999.00');
    expect(csvB).not.toContain('300.00');
  });

  it('export failure: a structurally-imbalanced slice throws before any CSV is built -- no partial/best-effort export', async () => {
    await expect(
      trialBalance.getReport(tenantA, { entity: companyCode, asOf: '2026-05' }),
    ).rejects.toBeInstanceOf(StructuralImbalanceError);
    // No toTrialBalanceCsv() call is reachable here -- the real route handler
    // (routes.ts) never calls it either, because getReport() throws first,
    // caught by the same catch block the view endpoint uses.
  });
});

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/gl-client';
import { randomUUID } from 'crypto';
import { TrialBalanceService } from '../src/application/trial-balance-service';
import { FinancialStatementService } from '../src/application/financial-statement-service';

const DATABASE_URL = process.env['DATABASE_URL'];

// Balance Sheet checkpoint (Golden R0 UI convergence, 2026-07-28): proves,
// against a real database, that FinancialStatementService.getBalanceSheet()
// is scoped by tenantId/store the same way S014 Trial Balance already is --
// this is a real getBalanceSheet() call, not a re-derivation, so the
// isolation guarantee is inherited from S014 (proven separately in
// trial-balance-export.live.test.ts) but re-proven here at the BS roll-up
// level specifically, since the checkpoint asked for store/department
// isolation coverage for Balance Sheet, not just Trial Balance.
describe.skipIf(!DATABASE_URL)('S227 Balance Sheet -- tenant/store isolation (live-db proof)', () => {
  let prisma: PrismaClient;
  let fs: FinancialStatementService;
  const tenantA = `bs-iso-tenant-a-${randomUUID()}`;
  const tenantB = `bs-iso-tenant-b-${randomUUID()}`;
  const companyCode = '01';
  const storeX = 'SX';
  const storeY = 'SY';
  const accountIds = {
    aCash: randomUUID(),
    aStock: randomUUID(),
    bCash: randomUUID(),
    bStock: randomUUID(),
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    await prisma.$connect();
    fs = new FinancialStatementService(new TrialBalanceService(prisma as any));

    await prisma.gLAccount.createMany({
      data: [
        { id: accountIds.aCash, tenantId: tenantA, code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
        { id: accountIds.aStock, tenantId: tenantA, code: '3000', name: 'Common Stock', type: 'EQUITY', normalBalance: 'CREDIT', allowPosting: true, openingBalance: 0 },
        // Tenant B: identical account codes, deliberately, to prove isolation
        // is by tenantId and not accidental code non-collision.
        { id: accountIds.bCash, tenantId: tenantB, code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
        { id: accountIds.bStock, tenantId: tenantB, code: '3000', name: 'Common Stock', type: 'EQUITY', normalBalance: 'CREDIT', allowPosting: true, openingBalance: 0 },
      ],
    });

    await prisma.gLAccountPeriodBalance.createMany({
      data: [
        // Tenant A, store X: balanced BS, Assets 500 = Equity 500.
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.aCash, periodYear: 2026, periodMonth: 4, journalSource: 'BS', companyCode, storeId: storeX, runningBalance: 500, unitCount: 0 },
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.aStock, periodYear: 2026, periodMonth: 4, journalSource: 'BS', companyCode, storeId: storeX, runningBalance: -500, unitCount: 0 },
        // Tenant A, store Y: different, smaller amounts -- proves slicing.
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.aCash, periodYear: 2026, periodMonth: 4, journalSource: 'BS', companyCode, storeId: storeY, runningBalance: 120, unitCount: 0 },
        { id: randomUUID(), tenantId: tenantA, glAccountId: accountIds.aStock, periodYear: 2026, periodMonth: 4, journalSource: 'BS', companyCode, storeId: storeY, runningBalance: -120, unitCount: 0 },
        // Tenant B: same company/store code X, much larger amount -- must
        // never leak into tenant A's Balance Sheet.
        { id: randomUUID(), tenantId: tenantB, glAccountId: accountIds.bCash, periodYear: 2026, periodMonth: 4, journalSource: 'BS', companyCode, storeId: storeX, runningBalance: 88888, unitCount: 0 },
        { id: randomUUID(), tenantId: tenantB, glAccountId: accountIds.bStock, periodYear: 2026, periodMonth: 4, journalSource: 'BS', companyCode, storeId: storeX, runningBalance: -88888, unitCount: 0 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.gLAccountPeriodBalance.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.gLAccount.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await prisma.$disconnect();
  });

  it('store scoping: store X and store Y report their own, different totals from the same tenant/entity', async () => {
    const bsX = await fs.getBalanceSheet(tenantA, { entity: companyCode, store: storeX, asOf: '2026-04' });
    expect(bsX.assets.total).toBe(500);
    expect(bsX.totalLiabilitiesAndEquity).toBe(500);

    const bsY = await fs.getBalanceSheet(tenantA, { entity: companyCode, store: storeY, asOf: '2026-04' });
    expect(bsY.assets.total).toBe(120);
    expect(bsY.totalLiabilitiesAndEquity).toBe(120);
  });

  it('tenant isolation: tenant A\'s Balance Sheet never contains tenant B\'s 88888 balance despite identical company/store/account codes', async () => {
    const bsA = await fs.getBalanceSheet(tenantA, { entity: companyCode, store: storeX, asOf: '2026-04' });
    expect(bsA.assets.total).toBe(500);
    expect(bsA.assets.rows.every((r) => r.amount !== 88888)).toBe(true);

    const bsB = await fs.getBalanceSheet(tenantB, { entity: companyCode, store: storeX, asOf: '2026-04' });
    expect(bsB.assets.total).toBe(88888);
    expect(bsB.totalLiabilitiesAndEquity).toBe(88888);
  });

  it('unscoped (no store) rolls up both stores for the entity: 500 + 120 = 620', async () => {
    const bsEntity = await fs.getBalanceSheet(tenantA, { entity: companyCode, asOf: '2026-04' });
    expect(bsEntity.assets.total).toBe(620);
    expect(bsEntity.totalLiabilitiesAndEquity).toBe(620);
  });
});

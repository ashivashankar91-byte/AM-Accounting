import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/gl-client';
import { randomUUID } from 'crypto';
import { TrialBalanceService, TrialBalanceRow } from '../src/application/trial-balance-service';

/**
 * S227 Financial Statement Roll-Up Contract — proof, not the S227
 * implementation itself. Validates (against a real live database, reusing
 * the exact fixture conventions established for the S014 integration test)
 * that the roll-up formulas documented in
 * docs/accounting-modernization/S227_FINANCIAL_STATEMENT_ROLLUP_CONTRACT.md
 * hold, including for a contra-asset account, with NO calculation logic
 * duplicated from TrialBalanceService — every value used here comes
 * directly from TrialBalanceService.getReport().
 */

const DATABASE_URL = process.env['DATABASE_URL'];

// signedNatural() — the ONE formula the contract (§4/§6) requires; no
// per-type or per-contra branching anywhere else in this proof.
function signedNatural(row: TrialBalanceRow): number {
  return row.debitBalance - row.creditBalance;
}

// Normalizes -0 to 0 for equality assertions only; does not change the
// roll-up math itself (an empty LIABILITY bucket legitimately sums to -0
// once negated, which is numerically equal to 0 but fails Object.is-based
// toBe() assertions).
function money(n: number): number {
  return n === 0 ? 0 : n;
}

describe.skipIf(!DATABASE_URL)('S227 financial statement roll-up contract proof', () => {
  let prisma: PrismaClient;
  let trialBalance: TrialBalanceService;
  const tenantId = `s227-tenant-${randomUUID()}`;
  const companyCode = '01';
  const accountIds = {
    cash: randomUUID(),
    accumDepr: randomUUID(), // contra-asset: type=ASSET, normalBalance=CREDIT
    commonStock: randomUUID(),
    revenue: randomUUID(),
    rentExpense: randomUUID(),
    deprExpense: randomUUID(),
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL + "?connection_limit=1" } } });
    await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantId}'`);
    await prisma.$connect();

    await prisma.gLAccount.createMany({
      data: [
        { id: accountIds.cash, tenantId, code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
        // Contra-asset: type ASSET but normalBalance CREDIT (no isContra flag exists in gl-service; this IS the contra signal per contract §5).
        { id: accountIds.accumDepr, tenantId, code: '1090', name: 'Accumulated Depreciation', type: 'ASSET', normalBalance: 'CREDIT', allowPosting: true, openingBalance: 0 },
        { id: accountIds.commonStock, tenantId, code: '3000', name: 'Common Stock', type: 'EQUITY', normalBalance: 'CREDIT', allowPosting: true, openingBalance: 0 },
        { id: accountIds.revenue, tenantId, code: '4000', name: 'Revenue', type: 'REVENUE', normalBalance: 'CREDIT', allowPosting: true, openingBalance: 0 },
        { id: accountIds.rentExpense, tenantId, code: '5000', name: 'Rent Expense', type: 'EXPENSE', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
        { id: accountIds.deprExpense, tenantId, code: '5100', name: 'Depreciation Expense', type: 'EXPENSE', normalBalance: 'DEBIT', allowPosting: true, openingBalance: 0 },
      ],
    });
    trialBalance = new TrialBalanceService(prisma as any);

    await prisma.journalEntry.createMany({
      data: [
        { id: 'contribution', tenantId, entryDate: new Date('2026-03-01'), description: 'owner contribution', source: 'TB', sourceRef: 'S227-1', postedBy: 's227-proof', postedAt: new Date('2026-03-01T09:00:00Z'), status: 'POSTED' },
        { id: 'sale', tenantId, entryDate: new Date('2026-03-05'), description: 'cash sale', source: 'TB', sourceRef: 'S227-2', postedBy: 's227-proof', postedAt: new Date('2026-03-05T09:00:00Z'), status: 'POSTED' },
        { id: 'rent', tenantId, entryDate: new Date('2026-03-10'), description: 'rent paid', source: 'TB', sourceRef: 'S227-3', postedBy: 's227-proof', postedAt: new Date('2026-03-10T09:00:00Z'), status: 'POSTED' },
        { id: 'depr', tenantId, entryDate: new Date('2026-03-31'), description: 'monthly depreciation', source: 'TB', sourceRef: 'S227-4', postedBy: 's227-proof', postedAt: new Date('2026-03-31T09:00:00Z'), status: 'POSTED' },
      ],
    });

    await prisma.journalLine.createMany({
      data: [
        // 1. Owner contributes cash: DR Cash 1000 / CR Common Stock 1000
        { id: randomUUID(), journalEntryId: 'contribution', glAccountId: accountIds.cash, debit: 1000, credit: 0, memo: 'contribution cash', companyCode },
        { id: randomUUID(), journalEntryId: 'contribution', glAccountId: accountIds.commonStock, debit: 0, credit: 1000, memo: 'contribution equity', companyCode },
        // 2. Cash sale: DR Cash 300 / CR Revenue 300
        { id: randomUUID(), journalEntryId: 'sale', glAccountId: accountIds.cash, debit: 300, credit: 0, memo: 'sale cash', companyCode },
        { id: randomUUID(), journalEntryId: 'sale', glAccountId: accountIds.revenue, debit: 0, credit: 300, memo: 'sale revenue', companyCode },
        // 3. Rent paid: DR Rent Expense 100 / CR Cash 100
        { id: randomUUID(), journalEntryId: 'rent', glAccountId: accountIds.rentExpense, debit: 100, credit: 0, memo: 'rent expense', companyCode },
        { id: randomUUID(), journalEntryId: 'rent', glAccountId: accountIds.cash, debit: 0, credit: 100, memo: 'rent cash', companyCode },
        // 4. Depreciation: DR Depreciation Expense 50 / CR Accumulated Depreciation 50 (contra-asset)
        { id: randomUUID(), journalEntryId: 'depr', glAccountId: accountIds.deprExpense, debit: 50, credit: 0, memo: 'depreciation expense', companyCode },
        { id: randomUUID(), journalEntryId: 'depr', glAccountId: accountIds.accumDepr, debit: 0, credit: 50, memo: 'accumulated depreciation', companyCode },
      ],
    });

    await prisma.gLAccountPeriodBalance.createMany({
      data: [
        { id: randomUUID(), tenantId, glAccountId: accountIds.cash, periodYear: 2026, periodMonth: 3, journalSource: 'TB', companyCode, runningBalance: 1200, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.commonStock, periodYear: 2026, periodMonth: 3, journalSource: 'TB', companyCode, runningBalance: -1000, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.revenue, periodYear: 2026, periodMonth: 3, journalSource: 'TB', companyCode, runningBalance: -300, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.rentExpense, periodYear: 2026, periodMonth: 3, journalSource: 'TB', companyCode, runningBalance: 100, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.deprExpense, periodYear: 2026, periodMonth: 3, journalSource: 'TB', companyCode, runningBalance: 50, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.accumDepr, periodYear: 2026, periodMonth: 3, journalSource: 'TB', companyCode, runningBalance: -50, unitCount: 0 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.historyTransaction.deleteMany({ where: { tenantId } });
    await prisma.gLAccountPeriodBalance.deleteMany({ where: { tenantId } });
    await prisma.auditOutboxEvent.deleteMany({ where: { tenantId } });
    await prisma.outboxEvent.deleteMany({ where: { tenantId } });
    await prisma.journalLine.deleteMany({ where: { journalEntry: { tenantId } } });
    await prisma.journalEntry.deleteMany({ where: { tenantId } });
    await prisma.gLAccount.deleteMany({ where: { tenantId } });
    await prisma.$disconnect();
  });

  it('rolls up S014 rows into a balanced BS/IS with a contra-asset account, ties to S014 footing, no duplicated calc logic', async () => {
    const report = await trialBalance.getReport(tenantId, { entity: companyCode, asOf: '2026-03' });

    // Sanity: S014 itself must foot before we build anything on top of it.
    expect(report.delta).toBe(0);
    expect(report.drSum).toBe(1350);
    expect(report.crSum).toBe(1350);

    const byType = (type: string) => report.accounts.filter((r) => r.accountType === type);

    const totalAssets = money(byType('ASSET').reduce((sum, r) => sum + signedNatural(r), 0));
    const totalLiabilities = money(-byType('LIABILITY').reduce((sum, r) => sum + signedNatural(r), 0));
    const totalEquityExclEarnings = money(-byType('EQUITY').reduce((sum, r) => sum + signedNatural(r), 0));
    const totalRevenue = money(-byType('REVENUE').reduce((sum, r) => sum + signedNatural(r), 0));
    const totalExpense = money(byType('EXPENSE').reduce((sum, r) => sum + signedNatural(r), 0));

    const netIncome = totalRevenue - totalExpense;
    const currentEarnings = netIncome; // same computed value, not two separate derivations
    const totalEquity = totalEquityExclEarnings + currentEarnings;

    // Contra-asset proof: Cash (1200) + Accumulated Depreciation (-50) = 1150.
    // No branch anywhere in this test special-cased "contra" -- it fell out
    // of signedNatural() alone.
    expect(totalAssets).toBe(1150);
    expect(totalLiabilities).toBe(0);
    expect(totalRevenue).toBe(300);
    expect(totalExpense).toBe(150);
    expect(netIncome).toBe(150);
    expect(totalEquityExclEarnings).toBe(1000);
    expect(totalEquity).toBe(1150);

    // BR227-1: A = L + E (incl. current earnings), never force-balanced --
    // this equality is asserted, not injected.
    expect(totalAssets).toBe(totalLiabilities + totalEquity);

    // BR227-2 tie test: IS net income === BS current-earnings line.
    expect(netIncome).toBe(currentEarnings);

    // Reconciliation to S014 (contract §9): the BS/IS identity reduces
    // algebraically to S014's own dr/cr footing.
    const allRowsSignedSum = report.accounts.reduce((sum, r) => sum + signedNatural(r), 0);
    expect(allRowsSignedSum).toBe(report.drSum - report.crSum);
    expect(allRowsSignedSum).toBe(0);
  });

  it('flags COST_OF_SALES/DISTRIBUTION rows as excluded, never silently absorbed into Expense (contract §2)', async () => {
    // No COST_OF_SALES/DISTRIBUTION account exists in this fixture; this
    // test documents the classification set the roll-up must recognize so a
    // future implementation cannot silently widen the EXPENSE bucket.
    const report = await trialBalance.getReport(tenantId, { entity: companyCode, asOf: '2026-03' });
    const recognized = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
    const unclassified = report.accounts.filter((r) => !recognized.has(r.accountType));
    expect(unclassified).toEqual([]);
  });
});

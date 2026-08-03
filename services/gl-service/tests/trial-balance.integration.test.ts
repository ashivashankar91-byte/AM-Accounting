import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../node_modules/.prisma/gl-client';
import { randomUUID } from 'crypto';
import { TrialBalanceService } from '../src/application/trial-balance-service';

const DATABASE_URL = process.env['DATABASE_URL'];

describe.skipIf(!DATABASE_URL)('S014 trial balance live-db proof', () => {
  let prisma: PrismaClient;
  let trialBalance: TrialBalanceService;
  const tenantId = `tb-tenant-${randomUUID()}`;
  const companyCode = '01';
  const store1 = 'S1';
  const store2 = 'S2';
  const deptSrv = 'SRV';
  const deptParts = 'PRT';
  const accountIds = {
    cash: randomUUID(),
    ap: randomUUID(),
    rev: randomUUID(),
    exp: randomUUID(),
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL + "?connection_limit=1" } } });
    await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantId}'`);
    await prisma.$connect();

    await prisma.gLAccount.createMany({
      data: [
        {
          id: accountIds.cash,
          tenantId,
          code: '1000',
          name: 'Cash',
          type: 'ASSET',
          normalBalance: 'DEBIT',
          allowPosting: true,
          openingBalance: 0,
        },
        {
          id: accountIds.ap,
          tenantId,
          code: '2000',
          name: 'Accounts Payable',
          type: 'LIABILITY',
          normalBalance: 'CREDIT',
          allowPosting: true,
          openingBalance: 0,
        },
        {
          id: accountIds.rev,
          tenantId,
          code: '4000',
          name: 'Revenue',
          type: 'REVENUE',
          normalBalance: 'CREDIT',
          allowPosting: true,
          openingBalance: 0,
        },
        {
          id: accountIds.exp,
          tenantId,
          code: '5000',
          name: 'Expense',
          type: 'EXPENSE',
          normalBalance: 'DEBIT',
          allowPosting: true,
          openingBalance: 0,
        },
      ],
    });
    trialBalance = new TrialBalanceService(prisma as any);
    await prisma.journalEntry.createMany({
      data: [
        {
          id: randomUUID(),
          tenantId,
          entryDate: new Date('2025-12-31'),
          description: 'prior opening',
          source: 'TB',
          sourceRef: 'TB-2025-12-31',
          postedBy: 'trial-balance-test',
          postedAt: new Date('2025-12-31T09:00:00Z'),
          status: 'POSTED',
        },
        {
          id: randomUUID(),
          tenantId,
          entryDate: new Date('2026-01-15'),
          description: 'jan sale',
          source: 'TB',
          sourceRef: 'TB-2026-01-15',
          postedBy: 'trial-balance-test',
          postedAt: new Date('2026-01-15T09:00:00Z'),
          status: 'POSTED',
        },
        {
          id: randomUUID(),
          tenantId,
          entryDate: new Date('2026-01-20'),
          description: 'jan expense',
          source: 'TB',
          sourceRef: 'TB-2026-01-20',
          postedBy: 'trial-balance-test',
          postedAt: new Date('2026-01-20T09:00:00Z'),
          status: 'POSTED',
        },
        {
          id: randomUUID(),
          tenantId,
          entryDate: new Date('2026-01-25'),
          description: 'reversed later',
          source: 'TB',
          sourceRef: 'TB-2026-01-25',
          postedBy: 'trial-balance-test',
          postedAt: new Date('2026-01-25T09:00:00Z'),
          status: 'REVERSED',
          reversedById: 'reversal-entry',
        },
        {
          id: 'reversal-entry',
          tenantId,
          entryDate: new Date('2026-02-10'),
          description: 'reversal',
          source: 'TB',
          sourceRef: 'REV-TB-2026-01-25',
          postedBy: 'trial-balance-test',
          postedAt: new Date('2026-02-10T09:00:00Z'),
          status: 'POSTED',
          reversalOfId: 'missing-original-link',
        },
        {
          id: randomUUID(),
          tenantId,
          entryDate: new Date('2026-02-05'),
          description: 'parts sale',
          source: 'TB',
          sourceRef: 'TB-2026-02-05',
          postedBy: 'trial-balance-test',
          postedAt: new Date('2026-02-05T09:00:00Z'),
          status: 'POSTED',
        },
      ],
    });

    const entries = await prisma.journalEntry.findMany({ where: { tenantId }, orderBy: { entryDate: 'asc' } });
    const [priorOpening, janSale, janExpense, janReversed, febParts, febReversal] = [
      entries.find((row) => row.entryDate.toISOString().startsWith('2025-12-31'))!,
      entries.find((row) => row.entryDate.toISOString().startsWith('2026-01-15'))!,
      entries.find((row) => row.entryDate.toISOString().startsWith('2026-01-20'))!,
      entries.find((row) => row.entryDate.toISOString().startsWith('2026-01-25'))!,
      entries.find((row) => row.entryDate.toISOString().startsWith('2026-02-05'))!,
      entries.find((row) => row.entryDate.toISOString().startsWith('2026-02-10'))!,
    ];

    await prisma.journalLine.createMany({
      data: [
        { id: randomUUID(), journalEntryId: janSale.id, glAccountId: accountIds.cash, debit: 300, credit: 0, memo: 'jan sale cash', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: janSale.id, glAccountId: accountIds.rev, debit: 0, credit: 300, memo: 'jan sale revenue', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: priorOpening.id, glAccountId: accountIds.cash, debit: 1000, credit: 0, memo: 'prior cash opening', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: priorOpening.id, glAccountId: accountIds.ap, debit: 0, credit: 1000, memo: 'prior ap opening', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: janExpense.id, glAccountId: accountIds.exp, debit: 120, credit: 0, memo: 'jan expense', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: janExpense.id, glAccountId: accountIds.cash, debit: 0, credit: 120, memo: 'jan expense cash', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: janReversed.id, glAccountId: accountIds.cash, debit: 50, credit: 0, memo: 'reversed later cash', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: janReversed.id, glAccountId: accountIds.rev, debit: 0, credit: 50, memo: 'reversed later revenue', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: febReversal.id, glAccountId: accountIds.cash, debit: 0, credit: 50, memo: 'reversal cash', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: febReversal.id, glAccountId: accountIds.rev, debit: 50, credit: 0, memo: 'reversal revenue', companyCode, storeId: store1, departmentCode: deptSrv },
        { id: randomUUID(), journalEntryId: febParts.id, glAccountId: accountIds.cash, debit: 200, credit: 0, memo: 'parts sale cash', companyCode, storeId: store2, departmentCode: deptParts },
        { id: randomUUID(), journalEntryId: febParts.id, glAccountId: accountIds.rev, debit: 0, credit: 200, memo: 'parts sale revenue', companyCode, storeId: store2, departmentCode: deptParts },
      ],
    });

    await prisma.gLAccountPeriodBalance.createMany({
      data: [
        { id: randomUUID(), tenantId, glAccountId: accountIds.cash, periodYear: 2025, periodMonth: 12, journalSource: 'TB', companyCode, storeId: store1, departmentCode: deptSrv, runningBalance: 1000, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.ap, periodYear: 2025, periodMonth: 12, journalSource: 'TB', companyCode, storeId: store1, departmentCode: deptSrv, runningBalance: -1000, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.cash, periodYear: 2026, periodMonth: 1, journalSource: 'TB', companyCode, storeId: store1, departmentCode: deptSrv, runningBalance: 230, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.rev, periodYear: 2026, periodMonth: 1, journalSource: 'TB', companyCode, storeId: store1, departmentCode: deptSrv, runningBalance: -350, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.exp, periodYear: 2026, periodMonth: 1, journalSource: 'TB', companyCode, storeId: store1, departmentCode: deptSrv, runningBalance: 120, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.cash, periodYear: 2026, periodMonth: 2, journalSource: 'TB', companyCode, storeId: store1, departmentCode: deptSrv, runningBalance: -50, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.rev, periodYear: 2026, periodMonth: 2, journalSource: 'TB', companyCode, storeId: store1, departmentCode: deptSrv, runningBalance: 50, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.cash, periodYear: 2026, periodMonth: 2, journalSource: 'TB', companyCode, storeId: store2, departmentCode: deptParts, runningBalance: 200, unitCount: 0 },
        { id: randomUUID(), tenantId, glAccountId: accountIds.rev, periodYear: 2026, periodMonth: 2, journalSource: 'TB', companyCode, storeId: store2, departmentCode: deptParts, runningBalance: -200, unitCount: 0 },
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

  it('proves BR014-2 zero variance between GLAccountPeriodBalance and raw posted journal rebuild', async () => {
    const comparison = await trialBalance.compareProjectionToRebuild(tenantId, {
      entity: companyCode,
      store: store1,
      dept: deptSrv,
      asOf: '2026-02',
    });

    expect(comparison.delta).toBe(0);
    expect(comparison.mismatches).toEqual([]);
    expect(comparison.projection.drSum).toBe(1300);
    expect(comparison.projection.crSum).toBe(1300);
    expect(comparison.rebuilt.drSum).toBe(1300);
    expect(comparison.rebuilt.crSum).toBe(1300);
  });

  it('keeps prior-period snapshots stable and supports store/department slicing', async () => {
    const january = await trialBalance.getReport(tenantId, {
      entity: companyCode,
      store: store1,
      dept: deptSrv,
      asOf: '2026-01',
    });
    const februaryOtherStore = await trialBalance.getReport(tenantId, {
      entity: companyCode,
      store: store2,
      dept: deptParts,
      asOf: '2026-02',
    });
    const empty = await trialBalance.getReport(tenantId, {
      entity: '99',
      store: 'NONE',
      dept: 'NONE',
      asOf: '2026-02',
    });

    expect(january.drSum).toBe(1350);
    expect(january.crSum).toBe(1350);
    expect(january.accounts.map((row) => [row.accountCode, row.endingBalance])).toEqual([
      ['1000', 1230],
      ['2000', 1000],
      ['4000', 350],
      ['5000', 120],
    ]);

    expect(februaryOtherStore.drSum).toBe(200);
    expect(februaryOtherStore.crSum).toBe(200);
    expect(februaryOtherStore.accounts.map((row) => [row.accountCode, row.endingBalance])).toEqual([
      ['1000', 200],
      ['4000', 200],
    ]);

    expect(empty.accounts).toEqual([]);
    expect(empty.drSum).toBe(0);
    expect(empty.crSum).toBe(0);
  });
});

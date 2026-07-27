import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  StructuralImbalanceError,
  TrialBalanceService,
} from '../src/application/trial-balance-service';
import { GLInquiryService } from '../../coa-service/src/application/gl-inquiry-service';

function makePrisma(overrides: Partial<any> = {}): any {
  return {
    gLAccount: { findMany: vi.fn().mockResolvedValue([]) },
    gLAccountPeriodBalance: { findMany: vi.fn().mockResolvedValue([]) },
    journalLine: { findMany: vi.fn().mockResolvedValue([]) },
    balanceSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
    coaOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (fn: any) => fn({
      coaOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
      auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
    })),
    ...overrides,
  };
}

describe('TrialBalanceService', () => {
  it('returns a footed trial balance for a company/store/dept slice and zero variance against raw rebuild', async () => {
    const accounts = [
      { id: 'cash', code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', openingBalance: 0 },
      { id: 'ap', code: '2000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT', openingBalance: 0 },
      { id: 'rev', code: '4000', name: 'Revenue', type: 'REVENUE', normalBalance: 'CREDIT', openingBalance: 0 },
      { id: 'exp', code: '5000', name: 'Expense', type: 'EXPENSE', normalBalance: 'DEBIT', openingBalance: 0 },
    ];
    const projectionRows = [
      { glAccountId: 'cash', periodYear: 2025, periodMonth: 12, runningBalance: 1000 },
      { glAccountId: 'ap', periodYear: 2025, periodMonth: 12, runningBalance: -1000 },
      { glAccountId: 'cash', periodYear: 2026, periodMonth: 1, runningBalance: 230 },
      { glAccountId: 'rev', periodYear: 2026, periodMonth: 1, runningBalance: -350 },
      { glAccountId: 'exp', periodYear: 2026, periodMonth: 1, runningBalance: 120 },
      { glAccountId: 'cash', periodYear: 2026, periodMonth: 2, runningBalance: -50 },
      { glAccountId: 'rev', periodYear: 2026, periodMonth: 2, runningBalance: 50 },
    ];
    const journalRows = [
      { glAccountId: 'cash', debit: 1000, credit: 0, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2025-12-31') } },
      { glAccountId: 'ap', debit: 0, credit: 1000, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2025-12-31') } },
      { glAccountId: 'cash', debit: 300, credit: 0, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2026-01-15') } },
      { glAccountId: 'rev', debit: 0, credit: 300, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2026-01-15') } },
      { glAccountId: 'exp', debit: 120, credit: 0, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2026-01-20') } },
      { glAccountId: 'cash', debit: 0, credit: 120, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2026-01-20') } },
      { glAccountId: 'cash', debit: 50, credit: 0, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2026-01-25') } },
      { glAccountId: 'rev', debit: 0, credit: 50, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2026-01-25') } },
      { glAccountId: 'cash', debit: 0, credit: 50, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2026-02-10') } },
      { glAccountId: 'rev', debit: 50, credit: 0, companyCode: '01', storeId: 'S1', departmentCode: 'SRV', journalEntry: { entryDate: new Date('2026-02-10') } },
    ];

    const prisma = makePrisma({
      gLAccount: { findMany: vi.fn().mockResolvedValue(accounts) },
      gLAccountPeriodBalance: { findMany: vi.fn().mockResolvedValue(projectionRows) },
      journalLine: { findMany: vi.fn().mockResolvedValue(journalRows) },
    });

    const svc = new TrialBalanceService(prisma);
    const report = await svc.getReport('tenant-a', { entity: '01', store: 'S1', dept: 'SRV', asOf: '2026-02' });

    expect(report.drSum).toBe(1300);
    expect(report.crSum).toBe(1300);
    expect(report.delta).toBe(0);
    expect(report.accounts.map((row) => [row.accountCode, row.endingBalance, row.debitBalance, row.creditBalance])).toEqual([
      ['1000', 1180, 1180, 0],
      ['2000', 1000, 0, 1000],
      ['4000', 300, 0, 300],
      ['5000', 120, 120, 0],
    ]);

    const comparison = await svc.compareProjectionToRebuild('tenant-a', {
      entity: '01',
      store: 'S1',
      dept: 'SRV',
      asOf: '2026-02',
    });
    expect(comparison.delta).toBe(0);
    expect(comparison.mismatches).toEqual([]);
    expect(comparison.projection.drSum).toBe(1300);
    expect(comparison.rebuilt.crSum).toBe(1300);
  });

  it('returns a zeroed trial balance for an empty slice', async () => {
    const prisma = makePrisma();
    const svc = new TrialBalanceService(prisma);

    const report = await svc.getReport('tenant-a', { entity: 'EMPTY', asOf: '2026-01' });
    expect(report.accounts).toEqual([]);
    expect(report.drSum).toBe(0);
    expect(report.crSum).toBe(0);
    expect(report.delta).toBe(0);
  });

  it('throws STRUCTURAL_IMBALANCE instead of silently returning an unbalanced trial balance', async () => {
    const prisma = makePrisma({
      gLAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cash', code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', openingBalance: 100 },
          { id: 'rev', code: '4000', name: 'Revenue', type: 'REVENUE', normalBalance: 'CREDIT', openingBalance: 0 },
        ]),
      },
      gLAccountPeriodBalance: {
        findMany: vi.fn().mockResolvedValue([
          { glAccountId: 'cash', periodYear: 2026, periodMonth: 1, runningBalance: 40 },
          { glAccountId: 'rev', periodYear: 2026, periodMonth: 1, runningBalance: -10 },
        ]),
      },
    });

    const svc = new TrialBalanceService(prisma);
    await expect(svc.getReport('tenant-a', { entity: '01', asOf: '2026-01' })).rejects.toEqual(
      expect.objectContaining<Partial<StructuralImbalanceError>>({
        code: 'STRUCTURAL_IMBALANCE',
        drSum: 40,
        crSum: 10,
        delta: 30,
      }),
    );
  });

  it('reconciles S014 endingBalance with coa-service S220 GLInquiryService on identical data', async () => {
    const s014Prisma = makePrisma({
      gLAccount: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'cash', code: '1000', name: 'Cash', type: 'ASSET', normalBalance: 'DEBIT', openingBalance: 0 },
          { id: 'ap', code: '2000', name: 'Accounts Payable', type: 'LIABILITY', normalBalance: 'CREDIT', openingBalance: 0 },
          { id: 'rev', code: '4000', name: 'Revenue', type: 'REVENUE', normalBalance: 'CREDIT', openingBalance: 0 },
          { id: 'exp', code: '5000', name: 'Expense', type: 'EXPENSE', normalBalance: 'DEBIT', openingBalance: 0 },
        ]),
      },
      gLAccountPeriodBalance: {
        findMany: vi.fn().mockResolvedValue([
          { glAccountId: 'cash', periodYear: 2025, periodMonth: 12, runningBalance: 1000 },
          { glAccountId: 'ap', periodYear: 2025, periodMonth: 12, runningBalance: -1000 },
          { glAccountId: 'cash', periodYear: 2026, periodMonth: 1, runningBalance: 230 },
          { glAccountId: 'rev', periodYear: 2026, periodMonth: 1, runningBalance: -350 },
          { glAccountId: 'exp', periodYear: 2026, periodMonth: 1, runningBalance: 120 },
        ]),
      },
    });
    const s014 = new TrialBalanceService(s014Prisma);
    const tb = await s014.getReport('tenant-a', { entity: '01', asOf: '2026-01' });
    const cashRow = tb.accounts.find((row) => row.accountCode === '1000');
    expect(cashRow?.endingBalance).toBe(1230);

    const coaPrisma = {
      balanceSnapshot: {
        findFirst: vi.fn().mockResolvedValue({
          balanceAfter: 1000,
        }),
      },
      journalLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            dr: 300,
            cr: 0,
            memo: 'sale',
            storeId: 'S1',
            deptCode: 'SRV',
            controlNumber: null,
            applyNumber: null,
            lineIndex: 1,
            entry: {
              id: 'je-1',
              journalNumber: 'GJ-0001',
              sourceCode: 'GJ',
              entryDate: new Date('2026-01-15'),
            },
          },
          {
            dr: 0,
            cr: 120,
            memo: 'expense cash',
            storeId: 'S1',
            deptCode: 'SRV',
            controlNumber: null,
            applyNumber: null,
            lineIndex: 2,
            entry: {
              id: 'je-2',
              journalNumber: 'GJ-0002',
              sourceCode: 'GJ',
              entryDate: new Date('2026-01-20'),
            },
          },
          {
            dr: 50,
            cr: 0,
            memo: 'reversed later',
            storeId: 'S1',
            deptCode: 'SRV',
            controlNumber: null,
            applyNumber: null,
            lineIndex: 3,
            entry: {
              id: 'je-3',
              journalNumber: 'GJ-0003',
              sourceCode: 'GJ',
              entryDate: new Date('2026-01-25'),
            },
          },
        ]),
      },
      $transaction: vi.fn(async (fn: any) => fn({
        coaOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
        auditOutboxEvent: { create: vi.fn().mockResolvedValue({}) },
      })),
    };
    const accountService = {
      get: vi.fn().mockResolvedValue({
        id: 'cash',
        accountNumber: '1000',
        name: 'Cash',
        normalBalance: 'DEBIT',
        entityId: 'entity-01',
      }),
    };
    const coa = new GLInquiryService(
      coaPrisma as any,
      { publish: vi.fn().mockResolvedValue(undefined) } as any,
      accountService as any,
    );

    const inquiry = await coa.getActivity(
      'tenant-a',
      'cash',
      { startDate: '2026-01-01', endDate: '2026-01-31' },
      { userId: 'tester' },
    );

    expect(inquiry.endingBalance).toBe(1230);
    expect(cashRow?.endingBalance).toBe(inquiry.endingBalance);
  });
});

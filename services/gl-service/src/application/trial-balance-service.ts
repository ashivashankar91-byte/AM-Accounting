import { inject, injectable } from 'tsyringe';
import { PrismaClient } from '.prisma/gl-client';

export interface TrialBalanceFilters {
  entity: string;
  store?: string;
  dept?: string;
  asOf: string; // YYYY-MM
}

export interface TrialBalanceRow {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  normalBalance: 'DEBIT' | 'CREDIT';
  priorBalance: number;
  currentAmount: number;
  endingBalance: number;
  debitBalance: number;
  creditBalance: number;
}

export interface TrialBalanceReport {
  scope: {
    entity: string;
    store: string | null;
    dept: string | null;
    asOf: string;
  };
  accounts: TrialBalanceRow[];
  drSum: number;
  crSum: number;
  delta: number;
}

export interface TrialBalanceVariance {
  accountCode: string;
  projectedEndingBalance: number;
  rebuiltEndingBalance: number;
  delta: number;
}

export interface TrialBalanceComparison {
  scope: TrialBalanceReport['scope'];
  projection: TrialBalanceReport;
  rebuilt: TrialBalanceReport;
  delta: number;
  mismatches: TrialBalanceVariance[];
}

export class StructuralImbalanceError extends Error {
  readonly statusCode = 500;
  readonly code = 'STRUCTURAL_IMBALANCE';

  constructor(
    public readonly drSum: number,
    public readonly crSum: number,
    public readonly delta: number,
  ) {
    super(`Trial balance does not foot: debits=${drSum} credits=${crSum} delta=${delta}`);
    this.name = 'StructuralImbalanceError';
  }
}

type AccountMeta = {
  id: string;
  code: string;
  name: string;
  type: string;
  normalBalance: 'DEBIT' | 'CREDIT';
};

type NetMaps = {
  prior: Map<string, number>;
  current: Map<string, number>;
};

@injectable()
export class TrialBalanceService {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  async getReport(tenantId: string, filters: TrialBalanceFilters): Promise<TrialBalanceReport> {
    const report = await this.buildFromProjection(tenantId, filters);
    this.assertFoots(report);
    return report;
  }

  async compareProjectionToRebuild(
    tenantId: string,
    filters: TrialBalanceFilters,
  ): Promise<TrialBalanceComparison> {
    const [projection, rebuilt] = await Promise.all([
      this.buildFromProjection(tenantId, filters),
      this.buildFromJournal(tenantId, filters),
    ]);

    const projectionByCode = new Map(
      projection.accounts.map((row) => [row.accountCode, row.endingBalance]),
    );
    const rebuiltByCode = new Map(
      rebuilt.accounts.map((row) => [row.accountCode, row.endingBalance]),
    );
    const allCodes = new Set([...projectionByCode.keys(), ...rebuiltByCode.keys()]);
    const mismatches: TrialBalanceVariance[] = [];

    for (const accountCode of allCodes) {
      const projectedEndingBalance = projectionByCode.get(accountCode) ?? 0;
      const rebuiltEndingBalance = rebuiltByCode.get(accountCode) ?? 0;
      const delta = this.money(projectedEndingBalance - rebuiltEndingBalance);
      if (Math.abs(delta) > 0.005) {
        mismatches.push({ accountCode, projectedEndingBalance, rebuiltEndingBalance, delta });
      }
    }

    return {
      scope: projection.scope,
      projection,
      rebuilt,
      delta: this.money(mismatches.reduce((sum, row) => sum + Math.abs(row.delta), 0)),
      mismatches: mismatches.sort((a, b) => a.accountCode.localeCompare(b.accountCode)),
    };
  }

  private async buildFromProjection(
    tenantId: string,
    filters: TrialBalanceFilters,
  ): Promise<TrialBalanceReport> {
    const period = this.parsePeriod(filters.asOf);
    const accounts = await this.loadAccounts(tenantId);
    const nets = await this.loadProjectionNets(tenantId, filters, period.year, period.month);
    return this.buildReport(filters, accounts, nets);
  }

  private async buildFromJournal(
    tenantId: string,
    filters: TrialBalanceFilters,
  ): Promise<TrialBalanceReport> {
    const period = this.parsePeriod(filters.asOf);
    const accounts = await this.loadAccounts(tenantId);
    const nets = await this.loadJournalNets(tenantId, filters, period.year, period.month);
    return this.buildReport(filters, accounts, nets);
  }

  private buildReport(
    filters: TrialBalanceFilters,
    accounts: AccountMeta[],
    nets: NetMaps,
  ): TrialBalanceReport {
    let drSum = 0;
    let crSum = 0;

    const rows = accounts
      .map((account): TrialBalanceRow => {
        const factor = account.normalBalance === 'CREDIT' ? -1 : 1;
        const priorBalance = this.money((nets.prior.get(account.id) ?? 0) * factor);
        const currentAmount = this.money((nets.current.get(account.id) ?? 0) * factor);
        const endingBalance = this.money(priorBalance + currentAmount);
        const { debitBalance, creditBalance } = this.toBalanceSides(endingBalance, account.normalBalance);
        drSum = this.money(drSum + debitBalance);
        crSum = this.money(crSum + creditBalance);
        return {
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          accountType: account.type,
          normalBalance: account.normalBalance,
          priorBalance,
          currentAmount,
          endingBalance,
          debitBalance,
          creditBalance,
        };
      })
      .filter((row) =>
        Math.abs(row.priorBalance) > 0.005 ||
        Math.abs(row.currentAmount) > 0.005 ||
        Math.abs(row.endingBalance) > 0.005,
      )
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    return {
      scope: {
        entity: filters.entity,
        store: filters.store ?? null,
        dept: filters.dept ?? null,
        asOf: filters.asOf,
      },
      accounts: rows,
      drSum: this.money(drSum),
      crSum: this.money(crSum),
      delta: this.money(drSum - crSum),
    };
  }

  private async loadAccounts(tenantId: string): Promise<AccountMeta[]> {
    const accounts = await this.prisma.gLAccount.findMany({
      where: { tenantId },
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        normalBalance: true,
      },
      orderBy: { code: 'asc' },
    });

    return accounts.map((account) => ({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      normalBalance: account.normalBalance as 'DEBIT' | 'CREDIT',
    }));
  }

  private async loadProjectionNets(
    tenantId: string,
    filters: TrialBalanceFilters,
    year: number,
    month: number,
  ): Promise<NetMaps> {
    const rows = await this.prisma.gLAccountPeriodBalance.findMany({
      where: {
        tenantId,
        companyCode: filters.entity,
        ...(filters.store ? { storeId: filters.store } : {}),
        ...(filters.dept ? { departmentCode: filters.dept } : {}),
        OR: [
          { periodYear: { lt: year } },
          { periodYear: year, periodMonth: { lte: month } },
        ],
      },
      select: {
        glAccountId: true,
        periodYear: true,
        periodMonth: true,
        runningBalance: true,
      },
    });

    const prior = new Map<string, number>();
    const current = new Map<string, number>();
    for (const row of rows) {
      const target =
        row.periodYear === year && row.periodMonth === month ? current : prior;
      target.set(
        row.glAccountId,
        this.money((target.get(row.glAccountId) ?? 0) + Number(row.runningBalance ?? 0)),
      );
    }
    return { prior, current };
  }

  private async loadJournalNets(
    tenantId: string,
    filters: TrialBalanceFilters,
    year: number,
    month: number,
  ): Promise<NetMaps> {
    const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);
    const startOfMonth = new Date(year, month - 1, 1);

    const rows = await this.prisma.journalLine.findMany({
      where: {
        companyCode: filters.entity,
        ...(filters.store ? { storeId: filters.store } : {}),
        ...(filters.dept ? { departmentCode: filters.dept } : {}),
        journalEntry: {
          tenantId,
          status: { in: ['POSTED', 'REVERSED'] },
          entryDate: { lte: endOfMonth },
        },
      },
      include: {
        journalEntry: { select: { entryDate: true } },
      },
    });

    const prior = new Map<string, number>();
    const current = new Map<string, number>();
    for (const row of rows) {
      const net = Number(row.debit) - Number(row.credit);
      const target = row.journalEntry.entryDate < startOfMonth ? prior : current;
      target.set(row.glAccountId, this.money((target.get(row.glAccountId) ?? 0) + net));
    }
    return { prior, current };
  }

  private toBalanceSides(
    endingBalance: number,
    normalBalance: 'DEBIT' | 'CREDIT',
  ): Pick<TrialBalanceRow, 'debitBalance' | 'creditBalance'> {
    const amount = Math.abs(this.money(endingBalance));
    if (amount < 0.005) return { debitBalance: 0, creditBalance: 0 };
    if (endingBalance >= 0) {
      return normalBalance === 'DEBIT'
        ? { debitBalance: amount, creditBalance: 0 }
        : { debitBalance: 0, creditBalance: amount };
    }
    return normalBalance === 'DEBIT'
      ? { debitBalance: 0, creditBalance: amount }
      : { debitBalance: amount, creditBalance: 0 };
  }

  private assertFoots(report: TrialBalanceReport): void {
    if (Math.abs(report.delta) > 0.005) {
      throw new StructuralImbalanceError(report.drSum, report.crSum, report.delta);
    }
  }

  private parsePeriod(asOf: string): { year: number; month: number } {
    const match = /^(\d{4})-(\d{2})$/.exec(asOf);
    if (!match) {
      throw new Error(`Invalid asOf period "${asOf}" — expected YYYY-MM.`);
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) {
      throw new Error(`Invalid asOf period "${asOf}" — month must be 01-12.`);
    }
    return { year, month };
  }

  private money(value: number): number {
    return Number(value.toFixed(2));
  }
}

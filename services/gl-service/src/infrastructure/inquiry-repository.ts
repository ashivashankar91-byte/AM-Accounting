import { injectable, inject } from 'tsyringe';
import { TenantId } from '@amacc/shared-kernel';
import { PrismaClient, Prisma } from '.prisma/gl-client';
import type { HistoryTransaction as PrismaHistoryTransaction, GLAccount as PrismaGLAccountJoin } from '.prisma/gl-client';
import { differenceInCalendarDays } from 'date-fns';

type HistoryTransactionWithGL = PrismaHistoryTransaction & { glAccount: PrismaGLAccountJoin };

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface PeriodJournalLine {
  source: string;
  runningBalance: string;
  unitCount: number;
  periodYear: number;
  periodMonth: number;
}

export type AgingBucket = 0 | 1 | 2 | 3 | 4; // Current / 30 / 60 / 90 / 120+

export interface HistoryLine {
  id: string;
  journalSource: string;
  transactionDate: string;
  referenceNumber: string;
  lineNumber: number;
  postType: string;
  glAccountCode: string;
  amount: string;
  costAmount: string;
  applyNumber: string | null;
  controlNumber: string | null;
  description: string | null;
  unitCount: number;
  autoPostFlag: string;
  postedAt: string;
}

export interface UnpostedBatch {
  source: string;
  batchDate: string;
  documentCount: number;
  totalDebits: string;
  totalCredits: string;
}

export interface TransactionJournalLine {
  journalEntryId: string;
  referenceNumber: string | null;
  description: string;
  lineNumber: number;
  controlNumber: string | null;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  applyNumber: string | null;
}

export interface BatchTotals {
  totalDebits: number;
  totalCredits: number;
  balance: number;
  documentCount: number;
}

export interface AutopostGroup {
  autopostDate: string;
  source: string;
  periodYear: number;
  periodMonth: number;
  accountCode: string;
  accountName: string;
  registerCount: number;
  registerAmount: string;
  mtdCount: number;
  mtdAmount: string;
}

// ── Repository ────────────────────────────────────────────────────────────────

@injectable()
export class InquiryRepository {
  constructor(@inject('PrismaClient') private readonly prisma: PrismaClient) {}

  // ── GL Account Inquiry — Type 1 & 3: period journal summaries ──────────────

  async getPeriodJournals(
    tenantId: TenantId,
    accountCode: string,
    periodYear: number,
    periodMonth: number,
  ): Promise<PeriodJournalLine[]> {
    const account = await this.prisma.gLAccount.findFirst({
      where: { tenantId, code: accountCode },
    });
    if (!account) return [];

    const rows = await this.prisma.gLAccountPeriodBalance.findMany({
      where: {
        tenantId,
        glAccountId: account.id,
        periodYear,
        periodMonth,
      },
      orderBy: { journalSource: 'asc' },
    });

    return rows.map((r) => ({
      source: r.journalSource,
      runningBalance: r.runningBalance.toString(),
      unitCount: r.unitCount,
      periodYear: r.periodYear,
      periodMonth: r.periodMonth,
    }));
  }

  // ── GL Account Inquiry — Type 2 & 4 & 5: history transactions ──────────────

  async getHistoryByAccount(
    tenantId: TenantId,
    accountCode: string,
    opts: {
      afterDate?: Date;
      onOrBeforeDate?: Date;
      source?: string;
      controlNumber?: string;
      fromDate?: Date;
      toDate?: Date;
    },
  ): Promise<HistoryLine[]> {
    const account = await this.prisma.gLAccount.findFirst({
      where: { tenantId, code: accountCode },
    });
    if (!account) return [];

    const where: Prisma.HistoryTransactionWhereInput = { tenantId, glAccountId: account.id };
    if (opts.afterDate || opts.onOrBeforeDate || opts.fromDate || opts.toDate) {
      const dateFilter: Prisma.DateTimeFilter<'HistoryTransaction'> = {};
      if (opts.afterDate) dateFilter.gt = opts.afterDate;
      if (opts.onOrBeforeDate) dateFilter.lte = opts.onOrBeforeDate;
      if (opts.fromDate) dateFilter.gte = opts.fromDate;
      if (opts.toDate) dateFilter.lte = opts.toDate;
      where.transactionDate = dateFilter;
    }
    if (opts.source) where.journalSource = opts.source;
    if (opts.controlNumber) where.controlNumber = opts.controlNumber;

    const rows = await this.prisma.historyTransaction.findMany({
      where,
      include: { glAccount: true },
      orderBy: [{ transactionDate: 'asc' }, { lineNumber: 'asc' }],
      take: 5000,
    });

    return rows.map(this.toHistoryLine);
  }

  // ── Transaction history by source+refno (inqtran) ─────────────────────────

  async getHistoryBySourceRef(
    tenantId: TenantId,
    source: string,
    referenceNumber: string,
    opts: { fromDate?: Date; toDate?: Date },
  ): Promise<HistoryLine[]> {
    const where: Prisma.HistoryTransactionWhereInput = { tenantId, journalSource: source, referenceNumber };
    if (opts.fromDate || opts.toDate) {
      const dateFilter: Prisma.DateTimeFilter<'HistoryTransaction'> = {};
      if (opts.fromDate) dateFilter.gte = opts.fromDate;
      if (opts.toDate) dateFilter.lte = opts.toDate;
      where.transactionDate = dateFilter;
    }

    let rows = await this.prisma.historyTransaction.findMany({
      where,
      include: { glAccount: true },
      orderBy: [{ transactionDate: 'asc' }, { lineNumber: 'asc' }],
    });

    // COBOL fallback: retry with "0" prepended to reference number
    if (rows.length === 0 && !referenceNumber.startsWith('0')) {
      const paddedRef = '0' + referenceNumber;
      rows = await this.prisma.historyTransaction.findMany({
        where: { ...where, referenceNumber: paddedRef },
        include: { glAccount: true },
        orderBy: [{ transactionDate: 'asc' }, { lineNumber: 'asc' }],
      });
    }

    return rows.map(this.toHistoryLine);
  }

  // ── Unposted batch list (tranpr picklist) ─────────────────────────────────

  async getUnpostedBatches(tenantId: TenantId): Promise<UnpostedBatch[]> {
    const entries = await this.prisma.journalEntry.findMany({
      where: { tenantId, status: 'DRAFT' },
      include: { lines: true },
      orderBy: [{ entryDate: 'desc' }, { source: 'asc' }],
    });

    // Group by (source, entryDate as date string)
    const map = new Map<string, { count: number; debits: number; credits: number }>();
    for (const entry of entries) {
      const dateStr = entry.entryDate.toISOString().slice(0, 10);
      const key = `${entry.source}__${dateStr}`;
      const existing = map.get(key) ?? { count: 0, debits: 0, credits: 0 };
      existing.count += 1;
      for (const line of entry.lines) {
        existing.debits += Number(line.debit);
        existing.credits += Number(line.credit);
      }
      map.set(key, existing);
    }

    return Array.from(map.entries()).map(([key, val]) => {
      const [source, batchDate] = key.split('__');
      return {
        source,
        batchDate,
        documentCount: val.count,
        totalDebits: val.debits.toFixed(2),
        totalCredits: val.credits.toFixed(2),
      };
    });
  }

  // ── Transaction journal detail (tranpr) ───────────────────────────────────

  async getTransactionJournal(
    tenantId: TenantId,
    source: string,
    batchDate: string,
  ): Promise<TransactionJournalLine[]> {
    const dateStart = new Date(batchDate + 'T00:00:00.000Z');
    const dateEnd = new Date(batchDate + 'T23:59:59.999Z');

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        source,
        status: 'DRAFT',
        entryDate: { gte: dateStart, lte: dateEnd },
      },
      include: {
        lines: {
          include: { glAccount: true },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: [{ sourceRef: 'asc' }],
    });

    const result: TransactionJournalLine[] = [];
    for (const entry of entries) {
      entry.lines.forEach((line, idx) => {
        result.push({
          journalEntryId: entry.id,
          referenceNumber: entry.sourceRef ?? null,
          description: entry.description,
          lineNumber: idx + 1,
          controlNumber: (line as any).dealNumber ?? null,
          accountCode: line.glAccount.code,
          accountName: line.glAccount.name,
          debit: Number(line.debit),
          credit: Number(line.credit),
          applyNumber: (line as any).roNumber ?? null,
        });
      });
    }
    return result;
  }

  // ── Transaction batch totals ───────────────────────────────────────────────

  async getBatchTotals(
    tenantId: TenantId,
    source: string,
    batchDate: string,
  ): Promise<BatchTotals> {
    const dateStart = new Date(batchDate + 'T00:00:00.000Z');
    const dateEnd = new Date(batchDate + 'T23:59:59.999Z');

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        tenantId,
        source,
        status: 'DRAFT',
        entryDate: { gte: dateStart, lte: dateEnd },
      },
      include: { lines: true },
    });

    let totalDebits = 0;
    let totalCredits = 0;
    for (const entry of entries) {
      for (const line of entry.lines) {
        totalDebits += Number(line.debit);
        totalCredits += Number(line.credit);
      }
    }

    return {
      totalDebits,
      totalCredits,
      balance: Math.round((totalDebits - totalCredits) * 100) / 100,
      documentCount: entries.length,
    };
  }

  // ── Autopost summary (transumm) ───────────────────────────────────────────

  async getAutopostSummary(
    tenantId: TenantId,
    choice: 1 | 2,
  ): Promise<AutopostGroup[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where: Prisma.HistoryTransactionWhereInput = {
      tenantId,
      autoPostFlag: 'Y',
    };
    if (choice === 1) {
      // Prior dates
      where.postedAt = { lt: today };
      where.autopostSummarizedAt = null; // not yet summarized
    } else {
      // Today
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      where.postedAt = { gte: today, lt: tomorrow };
    }

    const rows = await this.prisma.historyTransaction.findMany({
      where,
      include: { glAccount: true },
      orderBy: [{ postedAt: 'asc' }, { journalSource: 'asc' }, { transactionDate: 'asc' }],
    });

    // Group: postedAt(date) + source + periodYear + periodMonth + accountCode
    type GroupKey = string;
    const groups = new Map<GroupKey, {
      autopostDate: string;
      source: string;
      periodYear: number;
      periodMonth: number;
      accountCode: string;
      accountName: string;
      registerCount: number;
      registerAmount: number;
    }>();

    for (const row of rows) {
      const autopostDate = row.postedAt.toISOString().slice(0, 10);
      const periodYear = row.transactionDate.getFullYear();
      const periodMonth = row.transactionDate.getMonth() + 1;
      const accountCode = row.glAccount.code;
      const key = `${autopostDate}__${row.journalSource}__${periodYear}__${periodMonth}__${accountCode}`;

      const existing = groups.get(key) ?? {
        autopostDate,
        source: row.journalSource,
        periodYear,
        periodMonth,
        accountCode,
        accountName: row.glAccount.name,
        registerCount: 0,
        registerAmount: 0,
      };
      existing.registerCount += 1;
      existing.registerAmount += Number(row.amount);
      groups.set(key, existing);
    }

    // Fetch MTD balances for each unique (account, year, month) combo
    const accountIds = [...new Set(rows.map((r) => r.glAccountId))];
    const uniquePeriods = [...new Set(rows.map((r) =>
      `${r.glAccountId}__${r.transactionDate.getFullYear()}__${r.transactionDate.getMonth() + 1}`
    ))];

    const mtdMap = new Map<string, { mtdCount: number; mtdAmount: number }>();
    for (const periodKey of uniquePeriods) {
      const [glAccountId, yearStr, monthStr] = periodKey.split('__');
      const periodBalance = await this.prisma.gLAccountPeriodBalance.findMany({
        where: { tenantId, glAccountId, periodYear: parseInt(yearStr), periodMonth: parseInt(monthStr) },
      });
      const mtdAmount = periodBalance.reduce((s, pb) => s + Number(pb.runningBalance), 0);
      const mtdCount = periodBalance.reduce((s, pb) => s + pb.unitCount, 0);
      mtdMap.set(periodKey, { mtdAmount, mtdCount });
    }

    // Build result — for each group, look up account id and MTD
    const accountCodeToId = new Map(rows.map((r) => [r.glAccount.code, r.glAccountId]));
    return Array.from(groups.values()).map((g) => {
      const glAccountId = accountCodeToId.get(g.accountCode);
      const mtdKey = `${glAccountId}__${g.periodYear}__${g.periodMonth}`;
      const mtd = mtdMap.get(mtdKey) ?? { mtdCount: 0, mtdAmount: 0 };
      return {
        ...g,
        registerAmount: g.registerAmount.toFixed(2),
        mtdCount: mtd.mtdCount,
        mtdAmount: mtd.mtdAmount.toFixed(2),
      };
    });
  }

  // ── Mark autopost records as summarized (transumm Choice 1) ──────────────

  async markAutopostSummarized(tenantId: TenantId, beforeDate: Date): Promise<number> {
    const result = await this.prisma.historyTransaction.updateMany({
      where: {
        tenantId,
        autoPostFlag: 'Y',
        postedAt: { lt: beforeDate },
        autopostSummarizedAt: null,
      },
      data: { autopostSummarizedAt: new Date() },
    });
    return result.count;
  }

  // ── Aging bucket helper ────────────────────────────────────────────────────

  getAgingBucket(transactionDate: Date, referenceDate: Date): AgingBucket {
    const age = differenceInCalendarDays(referenceDate, transactionDate);
    if (age <= 0) return 0;
    if (age <= 30) return 1;
    if (age <= 60) return 2;
    if (age <= 90) return 3;
    return 4;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private toHistoryLine(row: HistoryTransactionWithGL): HistoryLine {
    return {
      id: row.id,
      journalSource: row.journalSource,
      transactionDate: row.transactionDate.toISOString().slice(0, 10),
      referenceNumber: row.referenceNumber,
      lineNumber: row.lineNumber,
      postType: row.postType,
      glAccountCode: row.glAccount.code,
      amount: row.amount.toString(),
      costAmount: row.costAmount.toString(),
      applyNumber: row.applyNumber ?? null,
      controlNumber: row.controlNumber ?? null,
      description: row.description ?? null,
      unitCount: row.unitCount,
      autoPostFlag: row.autoPostFlag,
      postedAt: row.postedAt.toISOString(),
    };
  }
}

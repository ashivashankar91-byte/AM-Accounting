import { inject, injectable } from 'tsyringe';
import { randomUUID } from 'crypto';
import type { PrismaClient } from '.prisma/gl-client';
import { TrialBalanceFilters, TrialBalanceRow, TrialBalanceService } from './trial-balance-service';

/**
 * S227 — Balance Sheet & Income Statement, built strictly per
 * docs/accounting-modernization/S227_FINANCIAL_STATEMENT_ROLLUP_CONTRACT.md,
 * extended by S009 per docs/accounting-modernization/S009_DECISION_MEMO.md
 * (Product decisions, 2026-07-28: BLK-08 Gross Profit placement, BLK-11
 * response versioning, DISTRIBUTION fail-closed presentation).
 *
 * This service performs NO independent ledger query and NO independent
 * balance computation. Every number here is a reclassification/summation of
 * rows already returned by the real, previously-certified S014
 * TrialBalanceService.getReport() call for the identical
 * {entity, store?, dept?, asOf} scope. Rounding is never redone here — it is
 * inherited entirely from S014's own money()-rounded debitBalance/
 * creditBalance values (contract §8).
 *
 * Deliberately NOT reused: services/gl-service/src/application/gl-service.ts
 * getBalanceSheet()/getIncomeStatement() — that prototype re-queries the
 * ledger independently, never calls money(), and reports `balanced` as a
 * boolean in a 200 response instead of erroring loudly on imbalance
 * (contract §10/§11).
 */

// schemaVersion 2 (S009, BLK-11): additive fields on the existing routes —
// no new /v2/ route path. See S009_DECISION_MEMO.md.
export const FS_SCHEMA_VERSION = 2;

// BS = {Assets, Liabilities, Equity}; IS = {Revenue, Cost of Sales, Expense}.
// S009/BLK-08 (Option A, approved): COST_OF_SALES is now a real IS section
// (Gross Profit = Revenue - CostOfSales), no longer excluded.
const STATEMENT_TYPES = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COST_OF_SALES']);

// DISTRIBUTION (S009): NOT a statement section — it is a posting-time
// percentage-split expansion mechanism (@cobol-origin getgldistr.cbl,
// gl-service.ts expandLines()), so a correctly-operating ledger never leaves
// a resting balance on one. Handled separately from STATEMENT_TYPES/classify()
// — see partitionDistribution() below. Never folded into Expense, never
// silently dropped.
const DISTRIBUTION_TYPE = 'DISTRIBUTION';

export interface StatementRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  amount: number;
}

export type ExcludedAccountReason = 'DISTRIBUTION_ZERO_BALANCE';

export interface ExcludedAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  reason: ExcludedAccountReason;
}

export interface BalanceSheetReport {
  schemaVersion: number;
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  assets: { rows: StatementRow[]; total: number };
  liabilities: { rows: StatementRow[]; total: number };
  equity: { rows: StatementRow[]; total: number; currentEarnings: number };
  totalLiabilitiesAndEquity: number;
  excludedAccounts: ExcludedAccount[];
  reconciledToTrialBalance: { drSum: number; crSum: number };
}

export interface IncomeStatementReport {
  schemaVersion: number;
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  revenue: { rows: StatementRow[]; total: number };
  /** S009/BLK-08: new section, Option A. */
  costOfSales: { rows: StatementRow[]; total: number };
  /** S009/BLK-08: Revenue - CostOfSales. */
  grossProfit: number;
  expense: { rows: StatementRow[]; total: number };
  netIncome: number;
  excludedAccounts: ExcludedAccount[];
}

/** BR227-1 exception workflow: never a forced-balanced statement. */
export class FSStructuralImbalanceError extends Error {
  readonly statusCode = 500;
  readonly code = 'STRUCTURAL_IMBALANCE';

  constructor(
    public readonly totalAssets: number,
    public readonly totalLiabilitiesAndEquity: number,
    public readonly delta: number,
  ) {
    super(
      `Balance sheet does not balance: assets=${totalAssets} liabilitiesAndEquity=${totalLiabilitiesAndEquity} delta=${delta}`,
    );
  }
}

/** Contract §2: unclassifiable accounts are a hard, loud failure — never a silent drop or misc bucket. */
export class UnclassifiedAccountTypeError extends Error {
  readonly statusCode = 500;
  readonly code = 'UNCLASSIFIED_ACCOUNT_TYPE';

  constructor(public readonly accounts: Array<{ accountCode: string; accountType: string }>) {
    super(
      `Unclassified account type(s) found and cannot be safely reported: ${accounts
        .map((a) => `${a.accountCode}(${a.accountType || 'EMPTY'})`)
        .join(', ')}`,
    );
  }
}

/**
 * S009/DISTRIBUTION decision (Product, 2026-07-28): a DISTRIBUTION-type
 * account is a posting-expansion mechanism, never a statement section. Its
 * resting balance must always be zero (all postings to it are expanded into
 * concrete target-account lines before the journal entry is saved — see
 * gl-service.ts expandLines()). A non-zero balance is a data-integrity
 * anomaly, not a scope gap: fail closed, never fold into Expense, never
 * silently exclude. No partial or misleading statement is returned.
 */
export class DistributionBalanceAnomalyError extends Error {
  readonly statusCode = 500;
  readonly code = 'DISTRIBUTION_BALANCE_ANOMALY';

  constructor(
    public readonly accounts: Array<{ accountCode: string; accountName: string; balance: number }>,
  ) {
    super(
      `DISTRIBUTION-type account(s) unexpectedly carry a non-zero balance ` +
        `(posting-expansion invariant violated — see S009_DECISION_MEMO.md): ${accounts
          .map((a) => `${a.accountCode}=${a.balance}`)
          .join(', ')}`,
    );
  }
}

@injectable()
export class FinancialStatementService {
  constructor(
    @inject(TrialBalanceService) private readonly trialBalance: TrialBalanceService,
    @inject('PrismaClient') private readonly prisma: PrismaClient,
  ) {}

  // Contract §4: the ONE formula used everywhere — no per-type or
  // per-contra branching. debitBalance/creditBalance already come out of
  // S014 normal-balance-aware, so a contra account (e.g. an ASSET-type
  // account with normalBalance=CREDIT) naturally nets with the correct
  // sign here with no special case (contract §5).
  private signedNatural(row: TrialBalanceRow): number {
    return row.debitBalance - row.creditBalance;
  }

  private classify(accounts: TrialBalanceRow[]): {
    byType: Map<string, TrialBalanceRow[]>;
  } {
    const byType = new Map<string, TrialBalanceRow[]>();
    const unclassified: Array<{ accountCode: string; accountType: string }> = [];

    for (const row of accounts) {
      // DISTRIBUTION rows are handled entirely by partitionDistribution()
      // before classify() is ever called (see getBalanceSheet/getIncomeStatement)
      // — never routed through the statement-type classifier.
      if (row.accountType === DISTRIBUTION_TYPE) continue;

      if (STATEMENT_TYPES.has(row.accountType)) {
        const bucket = byType.get(row.accountType) ?? [];
        bucket.push(row);
        byType.set(row.accountType, bucket);
      } else {
        unclassified.push({ accountCode: row.accountCode, accountType: row.accountType });
      }
    }

    // Hard error, never a silent drop (contract §2).
    if (unclassified.length > 0) {
      throw new UnclassifiedAccountTypeError(unclassified);
    }

    return { byType };
  }

  /**
   * S009/DISTRIBUTION decision: separates DISTRIBUTION-type rows from the
   * six real statement-bearing types before classification. A zero balance
   * (the expected, correctly-operating case) becomes a diagnostic-only
   * `excludedAccounts` entry. A non-zero balance fails the ENTIRE statement
   * request closed — no partial/misleading statement, never folded into
   * Expense — and is recorded as an audit/diagnostic event.
   */
  private async partitionDistribution(
    accounts: TrialBalanceRow[],
    tenantId: string,
    scope: { entity: string; store: string | null; dept: string | null; asOf: string },
  ): Promise<ExcludedAccount[]> {
    const zeroBalance: ExcludedAccount[] = [];
    const anomalies: Array<{ accountCode: string; accountName: string; balance: number }> = [];

    for (const row of accounts) {
      if (row.accountType !== DISTRIBUTION_TYPE) continue;
      const balance = Math.round(this.signedNatural(row) * 100) / 100;
      if (Math.abs(balance) < 0.005) {
        zeroBalance.push({
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
          reason: 'DISTRIBUTION_ZERO_BALANCE',
        });
      } else {
        anomalies.push({ accountCode: row.accountCode, accountName: row.accountName, balance });
      }
    }

    if (anomalies.length > 0) {
      // Diagnostic/audit evidence recorded even though the request itself
      // fails — this is discoverable, never a silent failure (S009 decision).
      await this.prisma.outboxEvent.create({
        data: {
          eventType: 'GL_DISTRIBUTION_BALANCE_ANOMALY_DETECTED',
          tenantId,
          payload: { scope, accounts: anomalies },
          correlationId: randomUUID(),
        },
      });
      throw new DistributionBalanceAnomalyError(anomalies);
    }

    return zeroBalance;
  }

  private toRows(rows: TrialBalanceRow[], sign: 1 | -1): { rows: StatementRow[]; total: number } {
    let total = 0;
    const out: StatementRow[] = rows
      // Deterministic ordering (required outcome): stable sort by account code.
      .slice()
      .sort((a, b) => a.accountCode.localeCompare(b.accountCode))
      .map((row) => {
        const amount = sign * this.signedNatural(row);
        total += amount;
        return {
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
          amount,
        };
      });
    // Reuses S014's own rounding convention (contract §8) — never
    // re-rounds independently; this is a plain sum of already-rounded values.
    return { rows: out, total: Math.round(total * 100) / 100 };
  }

  async getBalanceSheet(tenantId: string, filters: TrialBalanceFilters): Promise<BalanceSheetReport> {
    const tb = await this.trialBalance.getReport(tenantId as any, filters);
    const scope = { entity: filters.entity, store: filters.store ?? null, dept: filters.dept ?? null, asOf: filters.asOf };
    // Fail-closed distribution check runs BEFORE any other computation —
    // no partial or misleading statement is ever assembled (S009 decision).
    const distributionExcluded = await this.partitionDistribution(tb.accounts, tenantId, scope);
    const { byType } = this.classify(tb.accounts);

    const assets = this.toRows(byType.get('ASSET') ?? [], 1);
    const liabilities = this.toRows(byType.get('LIABILITY') ?? [], -1);
    const equityExclEarnings = this.toRows(byType.get('EQUITY') ?? [], -1);

    // Net income computed identically to getIncomeStatement() below — the
    // SAME derivation, not two independent code paths that might diverge
    // (contract §6 — this is what makes the BR227-2 tie test structural).
    // S009/BLK-08: netIncome now derives from Gross Profit (Revenue - Cost
    // of Sales) minus Expense, not Revenue - Expense directly.
    const revenue = this.toRows(byType.get('REVENUE') ?? [], -1);
    const costOfSales = this.toRows(byType.get('COST_OF_SALES') ?? [], 1);
    const expense = this.toRows(byType.get('EXPENSE') ?? [], 1);
    const grossProfit = Math.round((revenue.total - costOfSales.total) * 100) / 100;
    const netIncome = Math.round((grossProfit - expense.total) * 100) / 100;
    const currentEarnings = netIncome;

    const equityTotal = Math.round((equityExclEarnings.total + currentEarnings) * 100) / 100;
    const totalLiabilitiesAndEquity = Math.round((liabilities.total + equityTotal) * 100) / 100;
    const delta = Math.round((assets.total - totalLiabilitiesAndEquity) * 100) / 100;

    // BR227-1: never a forced-balanced statement. This is expected to be
    // 0 by construction (contract §9) — this check is a safety net, not
    // the primary correctness mechanism.
    if (delta !== 0) {
      throw new FSStructuralImbalanceError(assets.total, totalLiabilitiesAndEquity, delta);
    }

    return {
      schemaVersion: FS_SCHEMA_VERSION,
      scope,
      assets,
      liabilities,
      equity: { rows: equityExclEarnings.rows, total: equityTotal, currentEarnings },
      totalLiabilitiesAndEquity,
      excludedAccounts: distributionExcluded,
      reconciledToTrialBalance: { drSum: tb.drSum, crSum: tb.crSum },
    };
  }

  async getIncomeStatement(tenantId: string, filters: TrialBalanceFilters): Promise<IncomeStatementReport> {
    const tb = await this.trialBalance.getReport(tenantId as any, filters);
    const scope = { entity: filters.entity, store: filters.store ?? null, dept: filters.dept ?? null, asOf: filters.asOf };
    // Fail-closed distribution check runs BEFORE any other computation —
    // no partial or misleading statement is ever assembled (S009 decision).
    const distributionExcluded = await this.partitionDistribution(tb.accounts, tenantId, scope);
    const { byType } = this.classify(tb.accounts);

    // S009/BLK-08 (Option A, approved 2026-07-28):
    //   Revenue -> Cost of Sales -> GROSS PROFIT -> Operating Expenses -> NET INCOME
    const revenue = this.toRows(byType.get('REVENUE') ?? [], -1);
    const costOfSales = this.toRows(byType.get('COST_OF_SALES') ?? [], 1);
    const expense = this.toRows(byType.get('EXPENSE') ?? [], 1);
    const grossProfit = Math.round((revenue.total - costOfSales.total) * 100) / 100;
    const netIncome = Math.round((grossProfit - expense.total) * 100) / 100;

    return {
      schemaVersion: FS_SCHEMA_VERSION,
      scope,
      revenue,
      costOfSales,
      grossProfit,
      expense,
      netIncome,
      excludedAccounts: distributionExcluded,
    };
  }
}

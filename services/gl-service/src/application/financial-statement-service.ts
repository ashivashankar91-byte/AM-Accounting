import { inject, injectable } from 'tsyringe';
import { TrialBalanceFilters, TrialBalanceRow, TrialBalanceService } from './trial-balance-service';

/**
 * S227 — Balance Sheet & Income Statement, built strictly per
 * docs/accounting-modernization/S227_FINANCIAL_STATEMENT_ROLLUP_CONTRACT.md.
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

// The five statement-bearing types named in the approved Story Contract
// (row 12): BS = {Assets, Liabilities, Equity}; IS = {Revenue, Expense}.
const STATEMENT_TYPES = new Set(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);

// Explicitly out of scope for basic BS/IS per the approved contract
// (contract §2) — excluded from both statements, but surfaced as a
// diagnostic, never silently absorbed into Expense or dropped without trace.
const EXCLUDED_TYPES = new Set(['COST_OF_SALES', 'DISTRIBUTION']);

export interface StatementRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  amount: number;
}

export interface ExcludedAccount {
  accountCode: string;
  accountName: string;
  accountType: string;
  reason: 'OUT_OF_SCOPE_ACCOUNT_TYPE';
}

export interface BalanceSheetReport {
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  assets: { rows: StatementRow[]; total: number };
  liabilities: { rows: StatementRow[]; total: number };
  equity: { rows: StatementRow[]; total: number; currentEarnings: number };
  totalLiabilitiesAndEquity: number;
  excludedAccounts: ExcludedAccount[];
  reconciledToTrialBalance: { drSum: number; crSum: number };
}

export interface IncomeStatementReport {
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  revenue: { rows: StatementRow[]; total: number };
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

@injectable()
export class FinancialStatementService {
  constructor(@inject(TrialBalanceService) private readonly trialBalance: TrialBalanceService) {}

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
    excludedAccounts: ExcludedAccount[];
  } {
    const byType = new Map<string, TrialBalanceRow[]>();
    const excludedAccounts: ExcludedAccount[] = [];
    const unclassified: Array<{ accountCode: string; accountType: string }> = [];

    for (const row of accounts) {
      if (STATEMENT_TYPES.has(row.accountType)) {
        const bucket = byType.get(row.accountType) ?? [];
        bucket.push(row);
        byType.set(row.accountType, bucket);
      } else if (EXCLUDED_TYPES.has(row.accountType)) {
        excludedAccounts.push({
          accountCode: row.accountCode,
          accountName: row.accountName,
          accountType: row.accountType,
          reason: 'OUT_OF_SCOPE_ACCOUNT_TYPE',
        });
      } else {
        unclassified.push({ accountCode: row.accountCode, accountType: row.accountType });
      }
    }

    // Hard error, never a silent drop (contract §2).
    if (unclassified.length > 0) {
      throw new UnclassifiedAccountTypeError(unclassified);
    }

    return { byType, excludedAccounts };
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
    const { byType, excludedAccounts } = this.classify(tb.accounts);

    const assets = this.toRows(byType.get('ASSET') ?? [], 1);
    const liabilities = this.toRows(byType.get('LIABILITY') ?? [], -1);
    const equityExclEarnings = this.toRows(byType.get('EQUITY') ?? [], -1);

    // Net income computed identically to getIncomeStatement() below — the
    // SAME derivation, not two independent code paths that might diverge
    // (contract §6 — this is what makes the BR227-2 tie test structural).
    const revenue = this.toRows(byType.get('REVENUE') ?? [], -1);
    const expense = this.toRows(byType.get('EXPENSE') ?? [], 1);
    const netIncome = Math.round((revenue.total - expense.total) * 100) / 100;
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
      scope: { entity: filters.entity, store: filters.store ?? null, dept: filters.dept ?? null, asOf: filters.asOf },
      assets,
      liabilities,
      equity: { rows: equityExclEarnings.rows, total: equityTotal, currentEarnings },
      totalLiabilitiesAndEquity,
      excludedAccounts,
      reconciledToTrialBalance: { drSum: tb.drSum, crSum: tb.crSum },
    };
  }

  async getIncomeStatement(tenantId: string, filters: TrialBalanceFilters): Promise<IncomeStatementReport> {
    const tb = await this.trialBalance.getReport(tenantId as any, filters);
    const { byType, excludedAccounts } = this.classify(tb.accounts);

    const revenue = this.toRows(byType.get('REVENUE') ?? [], -1);
    const expense = this.toRows(byType.get('EXPENSE') ?? [], 1);
    const netIncome = Math.round((revenue.total - expense.total) * 100) / 100;

    return {
      scope: { entity: filters.entity, store: filters.store ?? null, dept: filters.dept ?? null, asOf: filters.asOf },
      revenue,
      expense,
      netIncome,
      excludedAccounts,
    };
  }
}

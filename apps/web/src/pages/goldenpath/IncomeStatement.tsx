import { useState } from 'react';
import { goldenPathApi } from '../../api/client';
import {
  EmptyState, ErrorState, LoadingState, MoneyTd, UnauthorizedState, formatMoney,
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportTr, ReportTd, TotalsRow,
  ExportMenu, RelatedLinks, Banner,
} from '../../components/report';
import { Btn } from '../../components/ui';

interface FSRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  amount: number;
}

interface IncomeStatementReport {
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  revenue: { rows: FSRow[]; total: number };
  expense: { rows: FSRow[]; total: number };
  netIncome: number;
  excludedAccounts: Array<{ accountCode: string; accountType: string; reason: string }>;
}

// Real, confirmed defect fix (Golden R0 UI convergence, Income Statement
// refinement, 2026-07-28): getIncomeStatement() calls TrialBalanceService
// .getReport() first (financial-statement-service.ts) -- if the underlying
// trial balance itself doesn't foot, it throws the TB-level
// StructuralImbalanceError, shape {drSum,crSum,delta}, BEFORE any
// revenue/expense classification happens. Unlike getBalanceSheet(),
// getIncomeStatement() never computes an assets/liabilities+equity delta and
// so never constructs FSStructuralImbalanceError itself -- only the TB-level
// shape is reachable through this screen today. Both shapes are still
// handled explicitly here (matching the Balance Sheet screen and the
// defensive export-route catch added this pass) so a future change that
// shares more code between the two statements can never silently render
// "NaN" the way the earlier Balance Sheet screen briefly did.
interface StructuralImbalance {
  error: 'STRUCTURAL_IMBALANCE';
  totalAssets?: number;
  totalLiabilitiesAndEquity?: number;
  drSum?: number;
  crSum?: number;
  delta: number;
}

interface UnclassifiedError {
  error: 'UNCLASSIFIED_ACCOUNT_TYPE';
  // FINAL-R0 defect fix (Golden R0 closure): the real gl-service
  // UnclassifiedAccountTypeError contract (financial-statement-service.ts)
  // always returns a plural `accounts` array -- supports reporting MULTIPLE
  // unclassified accounts in one response.
  accounts: Array<{ accountCode: string; accountType: string }>;
}

function Section({ title, rows, total, testPrefix }: { title: string; rows: FSRow[]; total: number; testPrefix: string }) {
  return (
    <div className="mt-4">
      <h3 className="text-[14px] font-semibold text-slate-900 mb-1.5">{title}</h3>
      <FinancialTable testId={`${testPrefix}-table`}>
        <tbody>
          {rows.map((r) => (
            <ReportTr key={r.accountCode} testId={`${testPrefix}-row-${r.accountCode}`}>
              <ReportTd>{r.accountCode}</ReportTd>
              <ReportTd>{r.accountName}</ReportTd>
              <MoneyTd value={r.amount} />
            </ReportTr>
          ))}
          <TotalsRow testId={`${testPrefix}-total`}>
            <ReportTd colSpan={2}>Total {title}</ReportTd>
            <MoneyTd value={total} bold />
          </TotalsRow>
        </tbody>
      </FinancialTable>
    </div>
  );
}

const now = new Date();
const defaultAsOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// FINAL-R0 / S227 — Income Statement Screen. Consumes the real gl-service
// FinancialStatementService API only — revenue/expense/netIncome figures are
// exactly what the API returned; COST_OF_SALES/DISTRIBUTION accounts are
// shown as diagnostics (excludedAccounts), never silently folded into
// Expense (per the accepted Roll-Up Contract). Net income ties to the
// Balance Sheet's current-period earnings line (see BalanceSheet.tsx
// bs-current-earnings), the real reconciliation point per the approved
// contract -- this report has no reconciledToTrialBalance field of its own.
//
// Golden R0 UI convergence — Phase 3: migrated onto the shared
// ReportShell/FilterBar/FinancialTable foundation (components/report,
// Phase 2). All data-testids, API calls and calculations are unchanged.
// Explicitly NOT added: comparative periods, YTD columns,
// percentage-of-revenue columns, department-level Gross Profit, or any
// client-side recomputation of backend totals.
export default function IncomeStatement() {
  const [entity, setEntity] = useState('01');
  const [store, setStore] = useState('');
  const [dept, setDept] = useState('');
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [report, setReport] = useState<IncomeStatementReport | null>(null);
  const [imbalance, setImbalance] = useState<StructuralImbalance | null>(null);
  const [unclassified, setUnclassified] = useState<UnclassifiedError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportUnauthorized, setExportUnauthorized] = useState<string | null>(null);

  async function runReport() {
    setBusy(true);
    setError(null);
    setUnauthorized(null);
    setImbalance(null);
    setUnclassified(null);
    setReport(null);
    setCsv(null);
    try {
      const result = await goldenPathApi.getIncomeStatement({
        entity,
        store: store || undefined,
        dept: dept || undefined,
        asOf,
      });
      setReport(result);
    } catch (err: any) {
      // Exception workflows per the accepted contract: a real structural
      // error or an unclassified account type must surface as a full-width
      // banner, never a silently-dropped or partially-rendered statement.
      if (err.status === 500 && err.body?.error === 'STRUCTURAL_IMBALANCE') {
        setImbalance(err.body);
      } else if (err.status === 500 && err.body?.error === 'UNCLASSIFIED_ACCOUNT_TYPE') {
        setUnclassified(err.body);
      } else if (err.status === 401 || err.status === 403) {
        setUnauthorized(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    if (exportBusy) return;
    setExportBusy(true);
    setExportError(null);
    setExportUnauthorized(null);
    try {
      const text = await goldenPathApi.exportIncomeStatement({
        entity,
        store: store || undefined,
        dept: dept || undefined,
        asOf,
      });
      setCsv(text);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `income-statement-${entity}-${asOf}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      // The export route reuses the identical view computation, so it can
      // fail with the exact same real error contracts -- reuse the same
      // banners rather than inventing a third, different message.
      if (err.status === 500 && err.body?.error === 'STRUCTURAL_IMBALANCE') {
        setImbalance(err.body);
      } else if (err.status === 500 && err.body?.error === 'UNCLASSIFIED_ACCOUNT_TYPE') {
        setUnclassified(err.body);
      } else if (err.status === 401 || err.status === 403) {
        setExportUnauthorized(err.message);
      } else {
        setExportError(err.message);
      }
    } finally {
      setExportBusy(false);
    }
  }

  const isEmpty = !!report && report.revenue.rows.length === 0 && report.expense.rows.length === 0;

  return (
    <ReportShell
      title="Income Statement"
      description="Revenue, expense and net income for a legal entity, as of a fiscal month."
      actions={
        <ExportMenu
          disabled={exportBusy}
          formats={[{ key: 'csv', label: exportBusy ? 'Exporting…' : 'Export CSV', onSelect: doExport, testId: 'is-export' }]}
        />
      }
    >
      {error && <ErrorState testId="is-error" message={error} />}
      {unauthorized && <UnauthorizedState testId="is-unauthorized" message={unauthorized} />}

      {imbalance && (
        <Banner kind="error" testId="is-structural-imbalance-banner" title="STRUCTURAL_IMBALANCE">
          {imbalance.totalAssets !== undefined ? (
            <>
              Assets do not equal Liabilities + Equity for this slice; the statement was not rendered.
              <div>Assets {formatMoney(imbalance.totalAssets)} vs Liabilities+Equity {formatMoney(imbalance.totalLiabilitiesAndEquity!)} — delta {formatMoney(imbalance.delta)}</div>
            </>
          ) : (
            <>
              The underlying trial balance for this slice does not foot; the statement cannot be produced until it does.
              <div>Debits {formatMoney(imbalance.drSum ?? 0)} vs Credits {formatMoney(imbalance.crSum ?? 0)} — delta {formatMoney(imbalance.delta)}</div>
            </>
          )}
        </Banner>
      )}

      {unclassified && (
        <Banner kind="error" testId="is-unclassified-banner" title="UNCLASSIFIED_ACCOUNT_TYPE">
          {unclassified.accounts.length === 1 ? 'Account' : 'Accounts'}{' '}
          {unclassified.accounts.map((a, i) => (
            <span key={a.accountCode}>
              {i > 0 && ', '}
              {a.accountCode} (type {a.accountType || 'EMPTY'})
            </span>
          ))}{' '}
          {unclassified.accounts.length === 1 ? 'is' : 'are'} not recognized by the approved Financial Statement Roll-Up Contract. The statement was not rendered.
        </Banner>
      )}

      <FilterBar>
        <FilterField label="Entity/Company" width={130}>
          <input data-testid="is-entity" value={entity} onChange={(e) => setEntity(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Store" width={90}>
          <input data-testid="is-store" value={store} onChange={(e) => setStore(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Dept" width={90}>
          <input data-testid="is-dept" value={dept} onChange={(e) => setDept(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="As of (YYYY-MM)" width={120}>
          <input data-testid="is-asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <Btn data-testid="is-run" size="sm" onClick={runReport} disabled={busy} loading={busy}>
          {busy ? 'Loading…' : 'Run Income Statement'}
        </Btn>
      </FilterBar>

      {busy && <LoadingState testId="is-loading" label="Producing income statement…" />}
      {exportBusy && <LoadingState testId="is-export-loading" label="Preparing export…" />}
      {exportError && <ErrorState testId="is-export-error" message={exportError} />}
      {exportUnauthorized && <UnauthorizedState testId="is-export-unauthorized" message={exportUnauthorized} />}

      {report && isEmpty && (
        <EmptyState
          testId="is-empty"
          title="No income statement data for this scope"
          message="No revenue or expense accounts were returned for this entity/store/department/period."
        />
      )}

      {report && !isEmpty && (
        <>
          <p className="text-[13px] text-slate-600 mt-1">
            Entity {report.scope.entity} — As of {report.scope.asOf}
            {report.scope.store ? ` — Store ${report.scope.store}` : ''}
            {report.scope.dept ? ` — Dept ${report.scope.dept}` : ''}
          </p>

          <Section title="Revenue" rows={report.revenue.rows} total={report.revenue.total} testPrefix="is-revenue" />
          <Section title="Expense" rows={report.expense.rows} total={report.expense.total} testPrefix="is-expense" />

          <FinancialTable className="mt-3">
            <tbody>
              <TotalsRow
                testId="is-net-income"
                className={report.netIncome >= 0 ? 'text-emerald-700' : 'text-red-700'}
              >
                <ReportTd colSpan={2}>Net Income</ReportTd>
                <MoneyTd value={report.netIncome} bold />
              </TotalsRow>
            </tbody>
          </FinancialTable>

          {report.excludedAccounts.length > 0 && (
            <div data-testid="is-excluded-accounts" className="mt-4 border border-amber-300 bg-amber-50 rounded-md p-3 text-[13px]">
              <strong>Out-of-scope accounts (excluded, not silently folded into Expense):</strong>
              <ul className="mt-1 pl-5 list-disc">
                {report.excludedAccounts.map((a) => (
                  <li key={a.accountCode}>{a.accountCode} ({a.accountType}) — {a.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {csv && (
            <pre data-testid="is-csv-preview" className="mt-4 bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] overflow-x-auto">{csv}</pre>
          )}
        </>
      )}

      {!report && !error && !unauthorized && !imbalance && !unclassified && !busy && (
        <EmptyState testId="is-initial-state" title="Run an Income Statement to see results." />
      )}

      <RelatedLinks
        links={[
          { label: 'Balance Sheet', to: '/golden-path/balance-sheet' },
          { label: 'Trial Balance', to: '/golden-path/trial-balance' },
          { label: 'Back to Journal Workflow', to: '/golden-path/journal' },
        ]}
      />
    </ReportShell>
  );
}

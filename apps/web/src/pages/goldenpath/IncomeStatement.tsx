import { useState } from 'react';
import { Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, MoneyCell, UnauthorizedState, formatMoney } from '../../components/goldenpath/shared';

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
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h3>
      <table data-testid={`${testPrefix}-table`} style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.accountCode} data-testid={`${testPrefix}-row-${r.accountCode}`}>
              <td>{r.accountCode}</td>
              <td>{r.accountName}</td>
              <MoneyCell value={r.amount} />
            </tr>
          ))}
          <tr data-testid={`${testPrefix}-total`} style={{ fontWeight: 700, borderTop: '1px solid #333' }}>
            <td colSpan={2}>Total {title}</td>
            <MoneyCell value={total} bold />
          </tr>
        </tbody>
      </table>
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
// PRODUCT CHECKPOINT (Golden R0 UI convergence, 2026-07-28) — Income
// Statement refinement: adopts the shared goldenpath components and the same
// unauthorized/export-loading/export-failure/export-unauthorized/empty
// states already accepted for Balance Sheet. Explicitly NOT added:
// comparative periods, YTD columns, percentage-of-revenue columns,
// department-level Gross Profit, or any client-side recomputation of
// backend totals.
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
    <div style={{ maxWidth: 960, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Income Statement</h1>
      {error && <ErrorState testId="is-error" message={error} />}
      {unauthorized && <UnauthorizedState testId="is-unauthorized" message={unauthorized} />}

      {imbalance && (
        <div data-testid="is-structural-imbalance-banner" style={{ background: '#fef2f2', border: '1px solid #b91c1c', color: '#991b1b', padding: 12, marginTop: 12 }}>
          <strong>STRUCTURAL_IMBALANCE</strong>{' '}
          {imbalance.totalAssets !== undefined ? (
            <>
              — Assets do not equal Liabilities + Equity for this slice; the statement was not rendered.
              <div>Assets {formatMoney(imbalance.totalAssets)} vs Liabilities+Equity {formatMoney(imbalance.totalLiabilitiesAndEquity!)} — delta {formatMoney(imbalance.delta)}</div>
            </>
          ) : (
            <>
              — the underlying trial balance for this slice does not foot; the statement cannot be produced until it does.
              <div>Debits {formatMoney(imbalance.drSum ?? 0)} vs Credits {formatMoney(imbalance.crSum ?? 0)} — delta {formatMoney(imbalance.delta)}</div>
            </>
          )}
        </div>
      )}

      {unclassified && (
        <div data-testid="is-unclassified-banner" style={{ background: '#fef2f2', border: '1px solid #b91c1c', color: '#991b1b', padding: 12, marginTop: 12 }}>
          <strong>UNCLASSIFIED_ACCOUNT_TYPE</strong> — {unclassified.accounts.length === 1 ? 'account' : 'accounts'}{' '}
          {unclassified.accounts.map((a, i) => (
            <span key={a.accountCode}>
              {i > 0 && ', '}
              {a.accountCode} (type {a.accountType || 'EMPTY'})
            </span>
          ))}{' '}
          {unclassified.accounts.length === 1 ? 'is' : 'are'} not recognized by the approved Financial Statement Roll-Up Contract. The statement was not rendered.
        </div>
      )}

      <section style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Entity/Company <input data-testid="is-entity" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 60 }} /></label>
        <label>Store <input data-testid="is-store" value={store} onChange={(e) => setStore(e.target.value)} style={{ width: 70 }} /></label>
        <label>Dept <input data-testid="is-dept" value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 70 }} /></label>
        <label>As of (YYYY-MM) <input data-testid="is-asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 90 }} /></label>
        <button data-testid="is-run" onClick={runReport} disabled={busy}>{busy ? 'Loading…' : 'Run Income Statement'}</button>
        {/* Export is a real, independent server query -- it must not be
            gated behind a successful view run (that would make it
            unreachable whenever the last view run hit STRUCTURAL_IMBALANCE
            or UNCLASSIFIED_ACCOUNT_TYPE, since report stays null on both
            paths -- the exact gap fixed on the Balance Sheet screen). */}
        <button data-testid="is-export" onClick={doExport} disabled={exportBusy}>
          {exportBusy ? 'Exporting…' : 'Export CSV'}
        </button>
      </section>

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
          <p style={{ marginTop: 12 }}>
            Entity {report.scope.entity} — As of {report.scope.asOf}
            {report.scope.store ? ` — Store ${report.scope.store}` : ''}
            {report.scope.dept ? ` — Dept ${report.scope.dept}` : ''}
          </p>

          <Section title="Revenue" rows={report.revenue.rows} total={report.revenue.total} testPrefix="is-revenue" />
          <Section title="Expense" rows={report.expense.rows} total={report.expense.total} testPrefix="is-expense" />

          <table style={{ width: '100%', marginTop: 8 }}>
            <tbody>
              <tr
                data-testid="is-net-income"
                style={{
                  fontWeight: 700, borderTop: '2px solid #333',
                  color: report.netIncome >= 0 ? '#166534' : '#991b1b',
                }}
              >
                <td colSpan={2}>Net Income</td>
                <MoneyCell value={report.netIncome} bold />
              </tr>
            </tbody>
          </table>

          {report.excludedAccounts.length > 0 && (
            <div data-testid="is-excluded-accounts" style={{ marginTop: 16, border: '1px solid #f59e0b', background: '#fffbeb', padding: 8 }}>
              <strong>Out-of-scope accounts (excluded, not silently folded into Expense):</strong>
              <ul>
                {report.excludedAccounts.map((a) => (
                  <li key={a.accountCode}>{a.accountCode} ({a.accountType}) — {a.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {csv && (
            <pre data-testid="is-csv-preview" style={{ marginTop: 16, background: '#f8f8f8', padding: 8, fontSize: 11, overflowX: 'auto' }}>{csv}</pre>
          )}
        </>
      )}

      {!report && !error && !unauthorized && !imbalance && !unclassified && !busy && (
        <EmptyState testId="is-initial-state" title="Run an Income Statement to see results." />
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/balance-sheet">Balance Sheet</Link>
        {' · '}
        <Link to="/golden-path/trial-balance">Trial Balance</Link>
        {' · '}
        <Link to="/golden-path/journal">Back to Journal Workflow</Link>
      </p>
    </div>
  );
}

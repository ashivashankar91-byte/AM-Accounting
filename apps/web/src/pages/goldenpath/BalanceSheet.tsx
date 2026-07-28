import { useState } from 'react';
import { Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, MoneyTd, UnauthorizedState, formatMoney } from '../../components/report';

interface FSRow {
  accountCode: string;
  accountName: string;
  accountType: string;
  amount: number;
}

interface BalanceSheetReport {
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  assets: { rows: FSRow[]; total: number };
  liabilities: { rows: FSRow[]; total: number };
  equity: { rows: FSRow[]; total: number; currentEarnings: number };
  totalLiabilitiesAndEquity: number;
  excludedAccounts: Array<{ accountCode: string; accountType: string; reason: string }>;
  reconciledToTrialBalance: { drSum: number; crSum: number };
}

// Real, confirmed defect fix (Golden R0 UI convergence, Balance Sheet
// refinement, 2026-07-28): getBalanceSheet() calls TrialBalanceService
// .getReport() first -- if the underlying trial balance itself doesn't
// foot, it throws the TB-level StructuralImbalanceError, shape
// {drSum,crSum,delta}, a DIFFERENT real error from FSStructuralImbalanceError
// (assets != liabilities+equity on an already-footed slice), shape
// {totalAssets,totalLiabilitiesAndEquity,delta} -- confirmed by reading
// financial-statement-service.ts and routes.ts directly, both share the
// error code STRUCTURAL_IMBALANCE but never both sets of fields at once.
// This screen previously assumed only the FS-level shape, so a TB-level
// imbalance would have rendered "NaN" for both amounts. Both real shapes
// are now handled explicitly, never assumed.
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
              <MoneyTd value={r.amount} />
            </tr>
          ))}
          <tr data-testid={`${testPrefix}-total`} style={{ fontWeight: 700, borderTop: '1px solid #333' }}>
            <td colSpan={2}>Total {title}</td>
            <MoneyTd value={total} bold />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const now = new Date();
const defaultAsOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// FINAL-R0 / S227 — Balance Sheet Screen. Consumes the real gl-service
// FinancialStatementService API only — every asset/liability/equity amount
// and the currentEarnings/A=L+E figures shown are exactly what the API
// returned; no classification, contra-account sign, or net-income
// calculation happens client-side (per PO instruction #4/#9 for S227).
//
// PRODUCT CHECKPOINT (Golden R0 UI convergence, 2026-07-28) — Balance Sheet
// refinement: adopts the shared goldenpath components, adds the previously
// missing unauthorized/export-loading/export-failure/export-unauthorized/
// empty states. Explicitly NOT added: comparative/prior-period columns, a
// rounding filter, or any client-side recomputation of backend totals --
// none of these are supported by the real S227 contract.
export default function BalanceSheet() {
  const [entity, setEntity] = useState('01');
  const [store, setStore] = useState('');
  const [dept, setDept] = useState('');
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
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
      const result = await goldenPathApi.getBalanceSheet({
        entity,
        store: store || undefined,
        dept: dept || undefined,
        asOf,
      });
      setReport(result);
    } catch (err: any) {
      // Exception workflows per the accepted contract: a real structural
      // error or an unclassified account type must surface as a full-width
      // banner, never a silently-balanced or silently-dropped render.
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
      const text = await goldenPathApi.exportBalanceSheet({
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
      a.download = `balance-sheet-${entity}-${asOf}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      // The export route reuses the identical view computation, so it can
      // fail with the exact same two real error contracts -- reuse the same
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

  const balanced = report ? Math.abs(report.assets.total - report.totalLiabilitiesAndEquity) < 0.005 : false;
  const isEmpty = !!report && report.assets.rows.length === 0 && report.liabilities.rows.length === 0 && report.equity.rows.length === 0;

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Balance Sheet</h1>
      {error && <ErrorState testId="bs-error" message={error} />}
      {unauthorized && <UnauthorizedState testId="bs-unauthorized" message={unauthorized} />}

      {imbalance && (
        <div data-testid="bs-structural-imbalance-banner" style={{ background: '#fef2f2', border: '1px solid #b91c1c', color: '#991b1b', padding: 12, marginTop: 12 }}>
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
        <div data-testid="bs-unclassified-banner" style={{ background: '#fef2f2', border: '1px solid #b91c1c', color: '#991b1b', padding: 12, marginTop: 12 }}>
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
        <label>Entity/Company <input data-testid="bs-entity" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 60 }} /></label>
        <label>Store <input data-testid="bs-store" value={store} onChange={(e) => setStore(e.target.value)} style={{ width: 70 }} /></label>
        <label>Dept <input data-testid="bs-dept" value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 70 }} /></label>
        <label>As of (YYYY-MM) <input data-testid="bs-asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 90 }} /></label>
        <button data-testid="bs-run" onClick={runReport} disabled={busy}>{busy ? 'Loading…' : 'Run Balance Sheet'}</button>
        {/* Export is a real, independent server query -- it must not be
            gated behind a successful view run (previously gated behind
            `report &&`, which made it unreachable whenever the last view
            run hit STRUCTURAL_IMBALANCE or UNCLASSIFIED_ACCOUNT_TYPE, since
            report stays null on both paths). */}
        <button data-testid="bs-export" onClick={doExport} disabled={exportBusy}>
          {exportBusy ? 'Exporting…' : 'Export CSV'}
        </button>
      </section>

      {busy && <LoadingState testId="bs-loading" label="Producing balance sheet…" />}
      {exportBusy && <LoadingState testId="bs-export-loading" label="Preparing export…" />}
      {exportError && <ErrorState testId="bs-export-error" message={exportError} />}
      {exportUnauthorized && <UnauthorizedState testId="bs-export-unauthorized" message={exportUnauthorized} />}

      {report && isEmpty && (
        <EmptyState
          testId="bs-empty"
          title="No balance sheet data for this scope"
          message="No asset, liability or equity accounts were returned for this entity/store/department/period."
        />
      )}

      {report && !isEmpty && (
        <>
          <p style={{ marginTop: 12 }}>
            Entity {report.scope.entity} — As of {report.scope.asOf}
            {report.scope.store ? ` — Store ${report.scope.store}` : ''}
            {report.scope.dept ? ` — Dept ${report.scope.dept}` : ''}
          </p>
          <div
            data-testid="bs-balanced-badge"
            style={{
              display: 'inline-block', padding: '4px 10px', borderRadius: 4, fontWeight: 600,
              background: balanced ? '#dcfce7' : '#fef2f2', color: balanced ? '#166534' : '#991b1b',
            }}
          >
            {balanced ? 'BALANCED' : 'NOT BALANCED'}
          </div>

          <Section title="Assets" rows={report.assets.rows} total={report.assets.total} testPrefix="bs-assets" />
          <Section title="Liabilities" rows={report.liabilities.rows} total={report.liabilities.total} testPrefix="bs-liabilities" />
          <Section title="Equity" rows={report.equity.rows} total={report.equity.total} testPrefix="bs-equity" />

          <table style={{ width: '100%', marginTop: 8 }}>
            <tbody>
              <tr data-testid="bs-current-earnings">
                <td colSpan={2}>Current-Period Earnings (included in Equity)</td>
                <MoneyTd value={report.equity.currentEarnings} />
              </tr>
              <tr data-testid="bs-grand-total" style={{ fontWeight: 700, borderTop: '2px solid #333' }}>
                <td colSpan={2}>Total Liabilities + Equity</td>
                <MoneyTd value={report.totalLiabilitiesAndEquity} bold />
              </tr>
              <tr data-testid="bs-reconciled-tb" style={{ color: '#555' }}>
                <td colSpan={2}>Reconciled to Trial Balance (Dr / Cr)</td>
                <td style={{ textAlign: 'right' }}>{formatMoney(report.reconciledToTrialBalance.drSum)} / {formatMoney(report.reconciledToTrialBalance.crSum)}</td>
              </tr>
            </tbody>
          </table>

          {report.excludedAccounts.length > 0 && (
            <div data-testid="bs-excluded-accounts" style={{ marginTop: 16, border: '1px solid #f59e0b', background: '#fffbeb', padding: 8 }}>
              <strong>Out-of-scope accounts (excluded, not silently absorbed):</strong>
              <ul>
                {report.excludedAccounts.map((a) => (
                  <li key={a.accountCode}>{a.accountCode} ({a.accountType}) — {a.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {csv && (
            <pre data-testid="bs-csv-preview" style={{ marginTop: 16, background: '#f8f8f8', padding: 8, fontSize: 11, overflowX: 'auto' }}>{csv}</pre>
          )}
        </>
      )}

      {!report && !error && !unauthorized && !imbalance && !unclassified && !busy && (
        <EmptyState testId="bs-initial-state" title="Run a Balance Sheet to see results." />
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/trial-balance">Trial Balance</Link>
        {' · '}
        <Link to="/golden-path/income-statement">Income Statement</Link>
        {' · '}
        <Link to="/golden-path/journal">Back to Journal Workflow</Link>
      </p>
    </div>
  );
}

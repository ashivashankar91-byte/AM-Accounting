import { useState } from 'react';
import { Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';

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

interface StructuralImbalance {
  error: 'STRUCTURAL_IMBALANCE';
  totalAssets: number;
  totalLiabilitiesAndEquity: number;
  delta: number;
}

interface UnclassifiedError {
  error: 'UNCLASSIFIED_ACCOUNT_TYPE';
  // FINAL-R0 defect fix (Golden R0 closure, this pass): the real
  // gl-service UnclassifiedAccountTypeError contract (financial-statement
  // -service.ts) always returns a plural `accounts` array -- it supports
  // reporting MULTIPLE unclassified accounts in one response, not a single
  // top-level accountCode/accountType. The previous single-field shape here
  // meant this banner ALWAYS rendered blank codes/types on every real
  // occurrence of this error (verified live: "account  has account type ,
  // which is not recognized..."), silently hiding which account(s) were
  // actually the problem. Found live while writing this closure pass's
  // negative-scenario Playwright coverage.
  accounts: Array<{ accountCode: string; accountType: string }>;
}

function fmt(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${abs})` : abs;
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
              <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(r.amount)}</td>
            </tr>
          ))}
          <tr data-testid={`${testPrefix}-total`} style={{ fontWeight: 700, borderTop: '1px solid #333' }}>
            <td colSpan={2}>Total {title}</td>
            <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(total)}</td>
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
export default function BalanceSheet() {
  const [entity, setEntity] = useState('01');
  const [store, setStore] = useState('');
  const [dept, setDept] = useState('');
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [imbalance, setImbalance] = useState<StructuralImbalance | null>(null);
  const [unclassified, setUnclassified] = useState<UnclassifiedError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);

  async function runReport() {
    setBusy(true);
    setError(null);
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
        setError(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
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
      setError(err.message);
    }
  }

  const balanced = report ? Math.abs(report.assets.total - report.totalLiabilitiesAndEquity) < 0.005 : false;

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Balance Sheet</h1>
      {error && <p data-testid="bs-error" style={{ color: '#b91c1c' }}>{error}</p>}

      {imbalance && (
        <div data-testid="bs-structural-imbalance-banner" style={{ background: '#fef2f2', border: '1px solid #b91c1c', color: '#991b1b', padding: 12, marginTop: 12 }}>
          <strong>STRUCTURAL_IMBALANCE</strong> — Assets do not equal Liabilities + Equity for this slice; the statement was not rendered.
          <div>Assets {fmt(imbalance.totalAssets)} vs Liabilities+Equity {fmt(imbalance.totalLiabilitiesAndEquity)} — delta {fmt(imbalance.delta)}</div>
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
        {report && <button data-testid="bs-export" onClick={doExport}>Export CSV</button>}
      </section>

      {report && (
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
                <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(report.equity.currentEarnings)}</td>
              </tr>
              <tr data-testid="bs-grand-total" style={{ fontWeight: 700, borderTop: '2px solid #333' }}>
                <td colSpan={2}>Total Liabilities + Equity</td>
                <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(report.totalLiabilitiesAndEquity)}</td>
              </tr>
              <tr data-testid="bs-reconciled-tb" style={{ color: '#555' }}>
                <td colSpan={2}>Reconciled to Trial Balance (Dr / Cr)</td>
                <td style={{ textAlign: 'right' }}>{fmt(report.reconciledToTrialBalance.drSum)} / {fmt(report.reconciledToTrialBalance.crSum)}</td>
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

      {!report && !error && !imbalance && !unclassified && !busy && (
        <p data-testid="bs-empty-state" style={{ marginTop: 24, color: '#666' }}>Run a Balance Sheet to see results.</p>
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

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';

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
  reconciledToTrialBalance: { drSum: number; crSum: number };
}

interface UnclassifiedError {
  error: 'UNCLASSIFIED_ACCOUNT_TYPE';
  accountCode: string;
  accountType: string;
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

// FINAL-R0 / S227 — Income Statement Screen. Consumes the real gl-service
// FinancialStatementService API only — revenue/expense/netIncome figures are
// exactly what the API returned; COST_OF_SALES/DISTRIBUTION accounts are
// shown as diagnostics (excludedAccounts), never silently folded into
// Expense (per the accepted Roll-Up Contract).
export default function IncomeStatement() {
  const [entity, setEntity] = useState('01');
  const [store, setStore] = useState('');
  const [dept, setDept] = useState('');
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [report, setReport] = useState<IncomeStatementReport | null>(null);
  const [unclassified, setUnclassified] = useState<UnclassifiedError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);

  async function runReport() {
    setBusy(true);
    setError(null);
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
      if (err.status === 500 && err.body?.error === 'UNCLASSIFIED_ACCOUNT_TYPE') {
        setUnclassified(err.body);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
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
      setError(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Income Statement</h1>
      {error && <p data-testid="is-error" style={{ color: '#b91c1c' }}>{error}</p>}

      {unclassified && (
        <div data-testid="is-unclassified-banner" style={{ background: '#fef2f2', border: '1px solid #b91c1c', color: '#991b1b', padding: 12, marginTop: 12 }}>
          <strong>UNCLASSIFIED_ACCOUNT_TYPE</strong> — account {unclassified.accountCode} has account type {unclassified.accountType}, which is not recognized by the approved Financial Statement Roll-Up Contract. The statement was not rendered.
        </div>
      )}

      <section style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Entity/Company <input data-testid="is-entity" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 60 }} /></label>
        <label>Store <input data-testid="is-store" value={store} onChange={(e) => setStore(e.target.value)} style={{ width: 70 }} /></label>
        <label>Dept <input data-testid="is-dept" value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 70 }} /></label>
        <label>As of (YYYY-MM) <input data-testid="is-asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 90 }} /></label>
        <button data-testid="is-run" onClick={runReport} disabled={busy}>{busy ? 'Loading…' : 'Run Income Statement'}</button>
        {report && <button data-testid="is-export" onClick={doExport}>Export CSV</button>}
      </section>

      {report && (
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
                <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(report.netIncome)}</td>
              </tr>
              <tr data-testid="is-reconciled-tb" style={{ color: '#555' }}>
                <td colSpan={2}>Reconciled to Trial Balance (Dr / Cr)</td>
                <td style={{ textAlign: 'right' }}>{fmt(report.reconciledToTrialBalance.drSum)} / {fmt(report.reconciledToTrialBalance.crSum)}</td>
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

      {!report && !error && !unclassified && !busy && (
        <p data-testid="is-empty-state" style={{ marginTop: 24, color: '#666' }}>Run an Income Statement to see results.</p>
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

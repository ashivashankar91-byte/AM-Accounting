import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';
import { Banner, EmptyState, ErrorState, LoadingState, MoneyCell, UnauthorizedState, formatMoney } from '../../components/goldenpath/shared';

interface TrialBalanceRow {
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

interface TrialBalanceReport {
  scope: { entity: string; store: string | null; dept: string | null; asOf: string };
  accounts: TrialBalanceRow[];
  drSum: number;
  crSum: number;
  delta: number;
}

interface StructuralImbalance {
  error: 'STRUCTURAL_IMBALANCE';
  drSum: number;
  crSum: number;
  delta: number;
}

function downloadCsv(report: TrialBalanceReport, rows: TrialBalanceRow[]) {
  // Client-side formatting of the already-computed S014 response only — no
  // dr/cr/ending-balance recalculation happens here (BR222-1 requirement:
  // S222 must not duplicate Trial Balance calculation logic).
  const header = ['Account', 'Name', 'Type', 'Prior', 'Activity', 'Ending', 'Debit', 'Credit'];
  const body = rows.map((r) => [
    r.accountCode, r.accountName, r.accountType,
    r.priorBalance.toFixed(2), r.currentAmount.toFixed(2), r.endingBalance.toFixed(2),
    r.debitBalance.toFixed(2), r.creditBalance.toFixed(2),
  ]);
  const csv = [header, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trial-balance-${report.scope.entity}-${report.scope.asOf}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const now = new Date();
const defaultAsOf = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

// FINAL-R0 / S222 — Trial Balance Screen. Not part of the sequential
// login->...->audit-history Golden Path (Trial Balance is not one of its
// steps); reachable directly for the Controller reporting workflow. Consumes
// the real S014 gl-service API only — every prior/activity/ending/dr/cr
// value shown is exactly what the API returned. `entity` is gl-service's own
// companyCode slice, not the tenant-service legalEntityId used elsewhere in
// the Golden Path (see api/client.ts comment on getTrialBalance) — the
// Controller enters it directly rather than it being inferred from entity
// selection.
//
// PRODUCT CHECKPOINT (Golden R0 UI convergence, 2026-07-28) — visual
// refinement pass: adopts the shared goldenpath components (Banner,
// MoneyCell, LoadingState/EmptyState/ErrorState/UnauthorizedState) and
// surfaces the real `priorBalance`/`currentAmount` (net activity) fields
// on-screen (previously CSV-export-only). Explicitly NOT changed: net
// activity stays a single column (no period-debit/period-credit split —
// the real API has no such split), OPEN_MONTH drill-through, and the
// fail-closed structural-imbalance behavior (the table never renders when
// the slice doesn't foot — only the banner does).
export default function TrialBalance() {
  const { legalEntityId } = useAuth();
  const [entity, setEntity] = useState('01');
  const [store, setStore] = useState('');
  const [dept, setDept] = useState('');
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [zeroSuppression, setZeroSuppression] = useState(false);
  const [report, setReport] = useState<TrialBalanceReport | null>(null);
  const [imbalance, setImbalance] = useState<StructuralImbalance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drillAccountCode, setDrillAccountCode] = useState<string | null>(null);
  const [drillRow, setDrillRow] = useState<TrialBalanceRow | null>(null);
  const [drillResult, setDrillResult] = useState<any>(null);
  const [drillError, setDrillError] = useState<string | null>(null);

  async function runReport() {
    setBusy(true);
    setError(null);
    setUnauthorized(null);
    setImbalance(null);
    setReport(null);
    try {
      const result = await goldenPathApi.getTrialBalance({
        entity,
        store: store || undefined,
        dept: dept || undefined,
        asOf,
      });
      setReport(result);
    } catch (err: any) {
      // BR222-1 / exception workflow: a real S014 structural error must
      // surface as a full-width banner, never a silently-unbalanced render.
      if (err.status === 500 && err.body?.error === 'STRUCTURAL_IMBALANCE') {
        setImbalance(err.body);
      } else if (err.status === 401 || err.status === 403) {
        setUnauthorized(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function drillToInquiry(row: TrialBalanceRow) {
    setDrillAccountCode(row.accountCode);
    setDrillRow(row);
    setDrillResult(null);
    setDrillError(null);
    if (!legalEntityId) {
      setDrillError('No legal entity selected in this session — cannot resolve a matching S220 account.');
      return;
    }
    try {
      const { accounts } = await goldenPathApi.listAccounts(legalEntityId);
      const match = accounts.find((a: any) => a.accountNumber === row.accountCode);
      if (!match) {
        // Honest gap: gl-service (S014) and coa-service (S220) are separate
        // ledgers today (ADR-JL-001). Cross-service drill only works when the
        // account number happens to also exist in this legal entity's COA.
        setDrillError(`No account numbered ${row.accountCode} exists in the current legal entity's Chart of Accounts — cross-service drill-through unavailable for this row.`);
        return;
      }
      // FINAL-R0 closure defect fix (UXMAP-03): real coa-service S220
      // QuerySchema only implements preset=OPEN_MONTH.
      const activity = await goldenPathApi.getAccountActivity(match.id, `preset=OPEN_MONTH`);
      setDrillResult(activity);
    } catch (err: any) {
      setDrillError(err.message);
    }
  }

  const rows = report ? (zeroSuppression ? report.accounts.filter((a) => a.endingBalance !== 0) : report.accounts) : [];

  // Subtotal-by-accountType — an aggregation of the rows already returned by
  // the API, not a recomputation of any dr/cr/ending value.
  const subtotalsByType = rows.reduce<Record<string, { debit: number; credit: number }>>((acc, r) => {
    const t = acc[r.accountType] ?? { debit: 0, credit: 0 };
    t.debit += r.debitBalance;
    t.credit += r.creditBalance;
    acc[r.accountType] = t;
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: 1040, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Trial Balance</h1>
      {error && <ErrorState testId="tb-error" message={error} />}
      {unauthorized && <UnauthorizedState testId="tb-unauthorized" message={unauthorized} />}

      {imbalance && (
        <Banner kind="error" testId="tb-structural-imbalance-banner" title="STRUCTURAL_IMBALANCE — this slice does not foot and was not rendered.">
          Debits {formatMoney(imbalance.drSum)} vs Credits {formatMoney(imbalance.crSum)} — delta {formatMoney(imbalance.delta)}
        </Banner>
      )}

      <section style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Entity/Company <input data-testid="tb-entity" value={entity} onChange={(e) => setEntity(e.target.value)} style={{ width: 60 }} /></label>
        <label>Store <input data-testid="tb-store" value={store} onChange={(e) => setStore(e.target.value)} style={{ width: 70 }} /></label>
        <label>Dept <input data-testid="tb-dept" value={dept} onChange={(e) => setDept(e.target.value)} style={{ width: 70 }} /></label>
        <label>As of (YYYY-MM) <input data-testid="tb-asof" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ width: 90 }} /></label>
        <label>
          <input type="checkbox" checked={zeroSuppression} onChange={(e) => setZeroSuppression(e.target.checked)} data-testid="tb-zero-suppression" />
          {' '}Suppress zero balances
        </label>
        <button data-testid="tb-run" onClick={runReport} disabled={busy}>{busy ? 'Loading…' : 'Run Trial Balance'}</button>
        {report && <button data-testid="tb-export" onClick={() => downloadCsv(report, rows)}>Export CSV</button>}
      </section>

      {busy && <LoadingState testId="tb-loading" label="Building trial balance…" />}

      {report && rows.length === 0 && (
        <EmptyState
          testId="tb-empty"
          title="No accounts to display"
          message={zeroSuppression ? 'Every account has a zero balance and zero balances are suppressed. Turn off suppression to see all accounts.' : 'No accounts were returned for this scope.'}
        />
      )}

      {report && rows.length > 0 && (
        <>
          <table data-testid="tb-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Account</th>
                <th style={{ textAlign: 'left' }}>Name</th>
                <th>Type</th>
                <th>Opening</th>
                <th>Activity</th>
                <th>Debit</th>
                <th>Credit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId} data-testid={`tb-row-${r.accountCode}`} onClick={() => drillToInquiry(r)} style={{ cursor: 'pointer' }}>
                  <td>{r.accountCode}</td>
                  <td>{r.accountName}</td>
                  <td>{r.accountType}</td>
                  <MoneyCell value={r.priorBalance} />
                  <MoneyCell value={r.currentAmount} />
                  <MoneyCell value={r.debitBalance || null} />
                  <MoneyCell value={r.creditBalance || null} />
                </tr>
              ))}
              {Object.entries(subtotalsByType).map(([type, sub]) => (
                <tr key={`subtotal-${type}`} data-testid={`tb-subtotal-${type}`} style={{ fontWeight: 600, borderTop: '1px solid #ddd' }}>
                  <td colSpan={5}>{type} subtotal</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(sub.debit)}</td>
                  <td style={{ textAlign: 'right' }}>{formatMoney(sub.credit)}</td>
                </tr>
              ))}
              <tr data-testid="tb-grand-total" style={{ fontWeight: 700, borderTop: '2px solid #333' }}>
                <td colSpan={5}>Total</td>
                <td style={{ textAlign: 'right' }}>{formatMoney(report.drSum)}</td>
                <td style={{ textAlign: 'right' }}>{formatMoney(report.crSum)}</td>
              </tr>
            </tbody>
          </table>

          {drillAccountCode && (
            <div data-testid="tb-drill-panel" style={{ marginTop: 16, border: '1px solid #ddd', padding: 12 }}>
              <div>Drill-through — account {drillAccountCode} (real S220 GL Inquiry)</div>
              {drillError && <ErrorState testId="tb-drill-error" message={drillError} />}
              {drillResult && (
                <div data-testid="tb-drill-result">
                  <div data-testid="tb-drill-account">
                    {drillResult.account?.accountNumber} — {drillResult.account?.name}
                  </div>
                  <div data-testid="tb-drill-period">
                    {drillResult.range?.preset ?? drillResult.range?.periodCode ?? `${drillResult.range?.startDate} to ${drillResult.range?.endDate}`}
                  </div>
                  <div>
                    Beginning {formatMoney(drillResult.beginningBalance ?? 0)} — Ending{' '}
                    <span data-testid="tb-drill-ending-balance">{formatMoney(drillResult.endingBalance ?? 0)}</span> —{' '}
                    Period debit <span data-testid="tb-drill-period-debit">{formatMoney(drillResult.periodDebitActivity ?? 0)}</span> —{' '}
                    Period credit <span data-testid="tb-drill-period-credit">{formatMoney(drillResult.periodCreditActivity ?? 0)}</span> —{' '}
                    {(drillResult.lines?.length ?? 0)} activity line(s) in the current legal entity
                  </div>
                  {drillRow && (
                    <div data-testid="tb-drill-source-row">
                      Trial Balance source row — Debit {formatMoney(drillRow.debitBalance)} — Credit {formatMoney(drillRow.creditBalance)}
                    </div>
                  )}
                  {(drillResult.lines ?? []).map((l: any, i: number) => (
                    <div key={l.journalEntryId ?? i} data-testid={`tb-drill-line-${i}`}>
                      {l.entryDate} — {l.journalNumber} — DR {formatMoney(l.dr)} / CR {formatMoney(l.cr)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/gl-search">GL Search</Link>
        {' · '}
        <Link to="/golden-path/balance-sheet">Balance Sheet</Link>
        {' · '}
        <Link to="/golden-path/income-statement">Income Statement</Link>
        {' · '}
        <Link to="/golden-path/journal">Back to Journal Workflow</Link>
      </p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, MoneyTd, UnauthorizedState, formatMoney } from '../../components/report';

interface ActivityLine {
  journalEntryId: string;
  journalNumber: string;
  entryDate: string;
  source: string;
  store: string;
  dept: string | null;
  memo: string | null;
  dr: number;
  cr: number;
  runningBalance: number;
}

interface AccountActivityView {
  account: { id: string; accountNumber: string; name: string; normalBalance: string; entityId: string };
  range: { startDate: string; endDate: string; periodCode: string | null; preset: string | null };
  filters: { storeId: string | null; deptCode: string | null };
  beginningBalance: number;
  endingBalance: number;
  periodDebitActivity: number;
  periodCreditActivity: number;
  lines: ActivityLine[];
  pagination: { page: number; pageSize: number; totalLines: number; totalPages: number };
}

// FINAL-R0 / S220 — GL Inquiry Screen. Rewires the routed
// /accounting/inquiry/gl entry point (previously calling the legacy
// gl-service /api/v1/gl/inquiry prototype endpoint) onto the certified
// coa-service GET /api/v1/coa/inquiry/accounts/:id/activity contract. Every
// balance shown (beginning, ending, period debit/credit activity, running
// balance per line) is exactly what the API returned — no client-side
// recomputation. Only "preset=OPEN_MONTH" is implemented server-side today
// (Story Contract field 22 leaves the other 11 preset names as an open,
// non-blocking SME question — UXMAP-04) so the range selector offers that
// one real preset plus an explicit custom date range, not a fabricated
// preset catalogue.
export default function GLInquiry() {
  const { legalEntityId } = useAuth();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [accountId, setAccountId] = useState('');
  const [rangeMode, setRangeMode] = useState<'OPEN_MONTH' | 'CUSTOM'>('OPEN_MONTH');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [storeId, setStoreId] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [page, setPage] = useState(1);

  const [report, setReport] = useState<AccountActivityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);

  const [drillLine, setDrillLine] = useState<ActivityLine | null>(null);
  const [drillJournal, setDrillJournal] = useState<any>(null);
  const [drillError, setDrillError] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const [deepLinkRun, setDeepLinkRun] = useState(false);

  useEffect(() => {
    if (!legalEntityId) return;
    goldenPathApi.listAccounts(legalEntityId).then((r) => setAccounts(r.accounts));
    goldenPathApi.listStores(legalEntityId).then((r) => setStores(r.items));
  }, [legalEntityId]);

  // S221 "open result in GL Inquiry" deep link: GLSearch.tsx navigates here
  // with ?accountId=&startDate=&endDate= (the search result row's real
  // accountId and a real date window around its entryDate) — auto-selects
  // the account and range and runs the real S220 query once, rather than
  // requiring a second manual step.
  useEffect(() => {
    if (!legalEntityId || deepLinkRun) return;
    const qpAccountId = searchParams.get('accountId');
    if (!qpAccountId) return;
    setDeepLinkRun(true);
    setAccountId(qpAccountId);
    const qpStart = searchParams.get('startDate');
    const qpEnd = searchParams.get('endDate');
    const params = new URLSearchParams();
    if (qpStart && qpEnd) {
      setRangeMode('CUSTOM');
      setStartDate(qpStart);
      setEndDate(qpEnd);
      params.set('startDate', qpStart);
      params.set('endDate', qpEnd);
    } else {
      params.set('preset', 'OPEN_MONTH');
    }
    params.set('page', '1');
    setBusy(true);
    goldenPathApi
      .getAccountActivity(qpAccountId, params.toString())
      .then((result) => setReport(result))
      .catch((err: any) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setError(err.message);
      })
      .finally(() => setBusy(false));
  }, [legalEntityId, searchParams, deepLinkRun]);

  if (!legalEntityId) {
    return (
      <div style={{ margin: 40 }}>
        <p>No legal entity selected.</p>
        <Link to="/golden-path/select-entity">Select a legal entity</Link>
      </div>
    );
  }

  function buildParams(forPage: number): string {
    const params = new URLSearchParams();
    if (rangeMode === 'OPEN_MONTH') {
      params.set('preset', 'OPEN_MONTH');
    } else {
      params.set('startDate', startDate);
      params.set('endDate', endDate);
    }
    if (storeId) params.set('storeId', storeId);
    if (deptCode) params.set('deptCode', deptCode);
    params.set('page', String(forPage));
    return params.toString();
  }

  async function runInquiry(forPage = 1) {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    setUnauthorized(null);
    setReport(null);
    setCsv(null);
    setDrillLine(null);
    setDrillJournal(null);
    setDrillError(null);
    try {
      const result = await goldenPathApi.getAccountActivity(accountId, buildParams(forPage));
      setReport(result);
      setPage(forPage);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        setUnauthorized(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    if (!accountId) return;
    try {
      const text = await goldenPathApi.exportAccountActivity(accountId, buildParams(1));
      setCsv(text);
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gl-inquiry-${accountId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function drillToJournal(line: ActivityLine) {
    setDrillLine(line);
    setDrillJournal(null);
    setDrillError(null);
    try {
      const j = await goldenPathApi.getJournal(line.journalNumber);
      setDrillJournal(j);
    } catch (err: any) {
      setDrillError(err.message);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>GL Inquiry</h1>
      {error && <ErrorState testId="gli-error" message={error} />}
      {unauthorized && <UnauthorizedState testId="gli-unauthorized" message={unauthorized} />}

      <section style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>
          Account{' '}
          <select data-testid="gli-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">Select an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.accountNumber} {a.name}</option>
            ))}
          </select>
        </label>
        <label>
          Range{' '}
          <select data-testid="gli-range-mode" value={rangeMode} onChange={(e) => setRangeMode(e.target.value as 'OPEN_MONTH' | 'CUSTOM')}>
            <option value="OPEN_MONTH">Current open period</option>
            <option value="CUSTOM">Custom date range</option>
          </select>
        </label>
        {rangeMode === 'CUSTOM' && (
          <>
            <label>From <input data-testid="gli-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
            <label>To <input data-testid="gli-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          </>
        )}
        <label>
          Store{' '}
          <select data-testid="gli-store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.storeCode ?? s.code ?? s.id}</option>
            ))}
          </select>
        </label>
        <label>Dept <input data-testid="gli-dept" placeholder="Dept" value={deptCode} onChange={(e) => setDeptCode(e.target.value)} style={{ width: 70 }} /></label>
        <button data-testid="gli-run" onClick={() => runInquiry(1)} disabled={busy || !accountId}>
          {busy ? 'Loading…' : 'Run Inquiry'}
        </button>
        {report && <button data-testid="gli-export" onClick={doExport}>Export CSV</button>}
      </section>

      {report && (
        <>
          <p style={{ marginTop: 12 }}>
            Account {report.account.accountNumber} — {report.account.name}
            {' · '}{report.range.preset ? 'Current open period' : `${report.range.startDate} to ${report.range.endDate}`}
            {report.range.periodCode ? ` (${report.range.periodCode})` : ''}
          </p>

          <table style={{ width: '100%', marginTop: 8 }}>
            <tbody>
              <tr data-testid="gli-beginning-balance">
                <td colSpan={2}>Beginning balance</td>
                <MoneyTd value={report.beginningBalance} />
              </tr>
              <tr data-testid="gli-period-debit">
                <td colSpan={2}>Period debit activity</td>
                <MoneyTd value={report.periodDebitActivity} />
              </tr>
              <tr data-testid="gli-period-credit">
                <td colSpan={2}>Period credit activity</td>
                <MoneyTd value={report.periodCreditActivity} />
              </tr>
              <tr data-testid="gli-ending-balance" style={{ fontWeight: 700, borderTop: '2px solid #333' }}>
                <td colSpan={2}>Ending balance</td>
                <MoneyTd value={report.endingBalance} bold />
              </tr>
            </tbody>
          </table>

          {report.lines.length === 0 ? (
            <EmptyState
              testId="gli-empty"
              title="No activity for this account in the selected range"
              message={`Beginning balance ${formatMoney(report.beginningBalance)}, no transactions matched the selected period, store and department.`}
            />
          ) : (
            <table data-testid="gli-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Date</th>
                  <th style={{ textAlign: 'left' }}>Journal #</th>
                  <th style={{ textAlign: 'left' }}>Source</th>
                  <th style={{ textAlign: 'left' }}>Memo</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Running balance</th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((l, i) => (
                  <tr
                    key={`${l.journalEntryId}-${i}`}
                    data-testid={`gli-row-${i}`}
                    onClick={() => drillToJournal(l)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>{l.entryDate}</td>
                    <td>{l.journalNumber}</td>
                    <td>{l.source}</td>
                    <td>{l.memo}</td>
                    <MoneyTd value={l.dr || null} />
                    <MoneyTd value={l.cr || null} />
                    <MoneyTd value={l.runningBalance} bold />
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {report.pagination.totalPages > 1 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button data-testid="gli-prev-page" disabled={page <= 1} onClick={() => runInquiry(page - 1)}>Previous</button>
              <span data-testid="gli-page-info">Page {report.pagination.page} of {report.pagination.totalPages}</span>
              <button data-testid="gli-next-page" disabled={page >= report.pagination.totalPages} onClick={() => runInquiry(page + 1)}>Next</button>
            </div>
          )}

          {drillLine && (
            <div data-testid="gli-drill-panel" style={{ marginTop: 16, border: '1px solid #ddd', padding: 12 }}>
              <div>Journal {drillLine.journalNumber}</div>
              {drillError && <p data-testid="gli-drill-error" style={{ color: '#92400e' }}>{drillError}</p>}
              {drillJournal && (
                <div data-testid="gli-drill-result">
                  Status {drillJournal.status} — {drillJournal.totalDebits} DR / {drillJournal.totalCredits} CR
                </div>
              )}
            </div>
          )}

          {csv && (
            <pre data-testid="gli-csv-preview" style={{ marginTop: 16, background: '#f8f8f8', padding: 8, fontSize: 11, overflowX: 'auto' }}>{csv}</pre>
          )}
        </>
      )}

      {!report && !error && !unauthorized && !busy && (
        <EmptyState testId="gli-initial-state" title="Select an account and run the inquiry to see activity." />
      )}

      {busy && <LoadingState testId="gli-loading" label="Loading account activity…" />}

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/gl-search">GL Search</Link>
        {' · '}
        <Link to="/golden-path/trial-balance">Trial Balance</Link>
        {' · '}
        <Link to="/golden-path/journal">Back to Journal Workflow</Link>
      </p>
    </div>
  );
}

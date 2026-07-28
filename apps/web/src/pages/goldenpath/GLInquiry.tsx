import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';
import {
  EmptyState, ErrorState, LoadingState, MoneyTd, UnauthorizedState, formatMoney,
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, TotalsRow,
  ExportMenu, Drawer, DrawerRow, RelatedLinks,
} from '../../components/report';
import { Btn } from '../../components/ui';

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
//
// Golden R0 UI convergence — Phase 3: migrated onto the shared
// ReportShell/FilterBar/FinancialTable/Drawer foundation
// (components/report, Phase 2). All data-testids, API calls and
// calculations are unchanged — the drill-through panel (gli-drill-panel)
// now opens as an actual right-side Drawer instead of an inline div.
export default function GLInquiry() {
  const { legalEntityId } = useAuth();
  const navigate = useNavigate();
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
  const [exportBusy, setExportBusy] = useState(false);

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
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <p className="text-slate-600">No legal entity selected.</p>
        <Link to="/golden-path/select-entity" className="text-[#0B5CAB] hover:underline">Select a legal entity</Link>
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
    if (!accountId || exportBusy) return;
    setExportBusy(true);
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
    } finally {
      setExportBusy(false);
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
    <ReportShell
      title="GL Inquiry"
      description="Account activity for a legal entity and period."
      actions={report ? (
        <ExportMenu
          disabled={exportBusy}
          formats={[{ key: 'csv', label: exportBusy ? 'Exporting…' : 'Export CSV', onSelect: doExport, testId: 'gli-export' }]}
        />
      ) : undefined}
    >
      {error && <ErrorState testId="gli-error" message={error} onRetry={() => runInquiry(page)} onBack={() => navigate(-1)} />}
      {unauthorized && <UnauthorizedState testId="gli-unauthorized" message={unauthorized} />}

      <FilterBar>
        <FilterField label="Account" width={260}>
          <select data-testid="gli-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={FILTER_CONTROL_CLASS}>
            <option value="">Select an account…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.accountNumber} {a.name}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Range" width={170}>
          <select data-testid="gli-range-mode" value={rangeMode} onChange={(e) => setRangeMode(e.target.value as 'OPEN_MONTH' | 'CUSTOM')} className={FILTER_CONTROL_CLASS}>
            <option value="OPEN_MONTH">Current open period</option>
            <option value="CUSTOM">Custom date range</option>
          </select>
        </FilterField>
        {rangeMode === 'CUSTOM' && (
          <>
            <FilterField label="From" width={140}>
              <input data-testid="gli-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label="To" width={140}>
              <input data-testid="gli-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
          </>
        )}
        <FilterField label="Store" width={140}>
          <select data-testid="gli-store" value={storeId} onChange={(e) => setStoreId(e.target.value)} className={FILTER_CONTROL_CLASS}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.storeCode ?? s.code ?? s.id}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Dept" width={90}>
          <input data-testid="gli-dept" placeholder="Dept" value={deptCode} onChange={(e) => setDeptCode(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <Btn data-testid="gli-run" size="sm" onClick={() => runInquiry(1)} disabled={busy || !accountId} loading={busy}>
          {busy ? 'Loading…' : 'Run Inquiry'}
        </Btn>
      </FilterBar>

      {report && (
        <>
          <p className="text-[13px] text-slate-600 mt-1 mb-3">
            Account {report.account.accountNumber} — {report.account.name}
            {' · '}{report.range.preset ? 'Current open period' : `${report.range.startDate} to ${report.range.endDate}`}
            {report.range.periodCode ? ` (${report.range.periodCode})` : ''}
          </p>

          <FinancialTable className="mb-4">
            <tbody>
              <ReportTr testId="gli-beginning-balance">
                <ReportTd colSpan={2}>Beginning balance</ReportTd>
                <MoneyTd value={report.beginningBalance} />
              </ReportTr>
              <ReportTr testId="gli-period-debit">
                <ReportTd colSpan={2}>Period debit activity</ReportTd>
                <MoneyTd value={report.periodDebitActivity} />
              </ReportTr>
              <ReportTr testId="gli-period-credit">
                <ReportTd colSpan={2}>Period credit activity</ReportTd>
                <MoneyTd value={report.periodCreditActivity} />
              </ReportTr>
              <TotalsRow testId="gli-ending-balance">
                <ReportTd colSpan={2}>Ending balance</ReportTd>
                <MoneyTd value={report.endingBalance} bold />
              </TotalsRow>
            </tbody>
          </FinancialTable>

          {report.lines.length === 0 ? (
            <EmptyState
              testId="gli-empty"
              title="No activity for this account in the selected range"
              message={`Beginning balance ${formatMoney(report.beginningBalance)}, no transactions matched the selected period, store and department.`}
            />
          ) : (
            <FinancialTable testId="gli-table">
              <ReportThead>
                <tr>
                  <ReportTh>Date</ReportTh>
                  <ReportTh>Journal #</ReportTh>
                  <ReportTh>Source</ReportTh>
                  <ReportTh>Memo</ReportTh>
                  <ReportTh align="right">Debit</ReportTh>
                  <ReportTh align="right">Credit</ReportTh>
                  <ReportTh align="right">Running balance</ReportTh>
                </tr>
              </ReportThead>
              <tbody>
                {report.lines.map((l, i) => (
                  <ReportTr key={`${l.journalEntryId}-${i}`} testId={`gli-row-${i}`} onClick={() => drillToJournal(l)}>
                    <ReportTd>{l.entryDate}</ReportTd>
                    <ReportTd>{l.journalNumber}</ReportTd>
                    <ReportTd>{l.source}</ReportTd>
                    <ReportTd>{l.memo}</ReportTd>
                    <MoneyTd value={l.dr || null} />
                    <MoneyTd value={l.cr || null} />
                    <MoneyTd value={l.runningBalance} bold />
                  </ReportTr>
                ))}
              </tbody>
            </FinancialTable>
          )}

          {report.pagination.totalPages > 1 && (
            <div className="flex items-center gap-3 mt-2 text-[13px]">
              <Btn data-testid="gli-prev-page" size="sm" variant="secondary" disabled={page <= 1} onClick={() => runInquiry(page - 1)}>Previous</Btn>
              <span data-testid="gli-page-info" className="text-slate-500">Page {report.pagination.page} of {report.pagination.totalPages}</span>
              <Btn data-testid="gli-next-page" size="sm" variant="secondary" disabled={page >= report.pagination.totalPages} onClick={() => runInquiry(page + 1)}>Next</Btn>
            </div>
          )}

          <Drawer
            open={Boolean(drillLine)}
            onClose={() => setDrillLine(null)}
            title={`Journal ${drillLine?.journalNumber ?? ''}`}
            testId="gli-drill-panel"
          >
            {drillError && <ErrorState testId="gli-drill-error" message={drillError} />}
            {drillJournal && (
              <div data-testid="gli-drill-result">
                <DrawerRow label="Status" value={drillJournal.status} />
                <DrawerRow label="Total debits" value={drillJournal.totalDebits} />
                <DrawerRow label="Total credits" value={drillJournal.totalCredits} />
              </div>
            )}
          </Drawer>

          {csv && (
            <pre data-testid="gli-csv-preview" className="mt-4 bg-slate-50 border border-slate-200 rounded-md p-3 text-[11px] overflow-x-auto">{csv}</pre>
          )}
        </>
      )}

      {!report && !error && !unauthorized && !busy && (
        <EmptyState testId="gli-initial-state" title="Select an account and run the inquiry to see activity." />
      )}

      {busy && <LoadingState testId="gli-loading" label="Loading account activity…" />}

      <RelatedLinks
        links={[
          { label: 'GL Search', to: '/golden-path/gl-search' },
          { label: 'Trial Balance', to: '/golden-path/trial-balance' },
          { label: 'Back to Journal Workflow', to: '/golden-path/journal' },
        ]}
      />
    </ReportShell>
  );
}

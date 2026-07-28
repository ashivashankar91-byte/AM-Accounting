import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';
import {
  Banner, EmptyState, ErrorState, LoadingState, MoneyTd, UnauthorizedState,
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, RelatedLinks,
} from '../../components/report';
import { Btn } from '../../components/ui';

interface GLSearchResultRow {
  journalEntryId: string;
  journalNumber: string;
  accountId: string;
  accountNumber: string;
  entryDate: string;
  source: string;
  store: string;
  dept: string | null;
  controlNumber: string | null;
  applyNumber: string | null;
  memo: string | null;
  dr: number;
  cr: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  totalResults: number;
  totalPages: number;
}

interface SavedSearch {
  id: string;
  name: string;
  criteria: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

// FINAL-R0 / S221 — GL Search Screen. Consumes only the real coa-service
// contracts (GET /api/v1/coa/inquiry/search, POST/GET/DELETE
// /api/v1/coa/inquiry/searches, GET /api/v1/coa/inquiry/searches/:id/run) —
// no client-side filtering, recomputation or invented fields. Per PRODUCT
// CHECKPOINT (Golden R0 UI convergence, 2026-07-28): no Account filter (not
// on the real SearchQuerySchema), no export (no export endpoint exists), no
// Update/Edit saved-search action (no update endpoint exists).
//
// Golden R0 UI convergence — Phase 3: migrated onto the shared
// ReportShell/FilterBar/FinancialTable foundation (components/report,
// Phase 2). All data-testids, API calls and validation/error behavior are
// unchanged — only the surrounding markup changed. No Export action in the
// header actions area, matching the confirmed absence of an export endpoint.
export default function GLSearch() {
  const navigate = useNavigate();

  const [entityId, setEntityId] = useState('');
  const [docRef, setDocRef] = useState('');
  const [source, setSource] = useState('');
  const [memoContains, setMemoContains] = useState('');
  const [postedBy, setPostedBy] = useState('');
  const [amount, setAmount] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [direction, setDirection] = useState<'' | 'DEBIT' | 'CREDIT'>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [results, setResults] = useState<GLSearchResultRow[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [savedSearches, setSavedSearches] = useState<SavedSearch[] | null>(null);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveConflict, setSaveConflict] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  function loadSavedSearches() {
    setSavedLoading(true);
    setSavedError(null);
    goldenPathApi
      .listSavedSearches()
      .then((r) => setSavedSearches(r.results))
      .catch((err: any) => setSavedError(err.message))
      .finally(() => setSavedLoading(false));
  }

  useEffect(() => {
    loadSavedSearches();
  }, []);

  function buildCriteria(): Record<string, string | number | undefined> {
    return {
      entityId: entityId || undefined,
      docRef: docRef || undefined,
      sourceCode: source || undefined,
      memoContains: memoContains || undefined,
      postedBy: postedBy || undefined,
      amount: amount ? Number(amount) : undefined,
      amountMin: amountMin ? Number(amountMin) : undefined,
      amountMax: amountMax ? Number(amountMax) : undefined,
      direction: direction || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
  }

  function restoreCriteria(criteria: Record<string, any>) {
    setEntityId(criteria.entityId ?? '');
    setDocRef(criteria.docRef ?? '');
    setSource(criteria.sourceCode ?? '');
    setMemoContains(criteria.memoContains ?? '');
    setPostedBy(criteria.postedBy ?? '');
    setAmount(criteria.amount !== undefined ? String(criteria.amount) : '');
    setAmountMin(criteria.amountMin !== undefined ? String(criteria.amountMin) : '');
    setAmountMax(criteria.amountMax !== undefined ? String(criteria.amountMax) : '');
    setDirection(criteria.direction ?? '');
    setStartDate(criteria.startDate ?? '');
    setEndDate(criteria.endDate ?? '');
  }

  async function runSearch(forPage = 1) {
    setBusy(true);
    setError(null);
    setValidationError(null);
    setUnauthorized(null);
    try {
      const res = await goldenPathApi.searchGL({ ...buildCriteria(), page: forPage });
      setResults(res.results);
      setPagination(res.pagination);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) {
        setUnauthorized(err.message);
      } else if (err.status === 400) {
        setValidationError(err.message);
      } else {
        setError(err.message);
      }
      setResults(null);
      setPagination(null);
    } finally {
      setBusy(false);
    }
  }

  async function doSave() {
    if (!saveName.trim()) return;
    setSaveBusy(true);
    setSaveConflict(null);
    setSaveSuccess(false);
    try {
      await goldenPathApi.saveSearch(saveName.trim(), buildCriteria());
      setSaveSuccess(true);
      setSaveName('');
      loadSavedSearches();
    } catch (err: any) {
      if (err.status === 409) {
        setSaveConflict(err.message);
      } else {
        setError(err.message);
      }
    } finally {
      setSaveBusy(false);
    }
  }

  async function doRunSaved(saved: SavedSearch) {
    setBusy(true);
    setError(null);
    setValidationError(null);
    setUnauthorized(null);
    restoreCriteria(saved.criteria);
    try {
      const res = await goldenPathApi.runSavedSearch(saved.id);
      setResults(res.results);
      setPagination(res.pagination);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else setError(err.message);
      setResults(null);
      setPagination(null);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete(id: string) {
    setDeleteBusy(true);
    setDeleteSuccess(false);
    try {
      await goldenPathApi.deleteSavedSearch(id);
      setDeleteSuccess(true);
      setDeleteConfirmId(null);
      loadSavedSearches();
    } catch (err: any) {
      setSavedError(err.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  function openInInquiry(row: GLSearchResultRow) {
    const [y, m] = row.entryDate.split('-');
    const monthStart = `${y}-${m}-01`;
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    const monthEnd = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
    navigate(`/accounting/inquiry/gl?accountId=${row.accountId}&startDate=${monthStart}&endDate=${monthEnd}`);
  }

  return (
    <ReportShell title="GL Search" description="Search posted GL activity across journals and accounts.">
      {error && <ErrorState testId="gls-error" message={error} />}
      {validationError && <ErrorState testId="gls-validation-error" message={validationError} />}
      {unauthorized && <UnauthorizedState testId="gls-unauthorized" message={unauthorized} />}

      <FilterBar>
        <FilterField label="Entity" width={90}>
          <input data-testid="gls-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Document/Control #" width={150}>
          <input data-testid="gls-docref" value={docRef} onChange={(e) => setDocRef(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Source" width={80}>
          <input data-testid="gls-source" value={source} onChange={(e) => setSource(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Memo contains" width={170}>
          <input data-testid="gls-memo" value={memoContains} onChange={(e) => setMemoContains(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Posted by" width={110}>
          <input data-testid="gls-posted-by" value={postedBy} onChange={(e) => setPostedBy(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Amount" width={90}>
          <input data-testid="gls-amount" value={amount} onChange={(e) => setAmount(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Amount min" width={90}>
          <input data-testid="gls-amount-min" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Amount max" width={90}>
          <input data-testid="gls-amount-max" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="Direction" width={100}>
          <select data-testid="gls-direction" value={direction} onChange={(e) => setDirection(e.target.value as '' | 'DEBIT' | 'CREDIT')} className={FILTER_CONTROL_CLASS}>
            <option value="">Any</option>
            <option value="DEBIT">Debit</option>
            <option value="CREDIT">Credit</option>
          </select>
        </FilterField>
        <FilterField label="From" width={140}>
          <input data-testid="gls-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <FilterField label="To" width={140}>
          <input data-testid="gls-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={FILTER_CONTROL_CLASS} />
        </FilterField>
        <Btn data-testid="gls-run" size="sm" onClick={() => runSearch(1)} disabled={busy} loading={busy}>
          {busy ? 'Searching…' : 'Search'}
        </Btn>
      </FilterBar>

      {busy && <LoadingState testId="gls-loading" label="Searching…" />}

      {results && results.length === 0 && (
        <EmptyState testId="gls-empty" title="No matching GL activity found" message="Widen the date range or clear a filter." />
      )}

      {results && results.length > 0 && (
        <>
          <FinancialTable testId="gls-table">
            <ReportThead>
              <tr>
                <ReportTh>Journal #</ReportTh>
                <ReportTh>Account</ReportTh>
                <ReportTh>Date</ReportTh>
                <ReportTh>Source</ReportTh>
                <ReportTh align="right">Debit</ReportTh>
                <ReportTh align="right">Credit</ReportTh>
                <ReportTh>Open</ReportTh>
              </tr>
            </ReportThead>
            <tbody>
              {results.map((r, i) => (
                <ReportTr key={`${r.journalEntryId}-${r.accountId}-${i}`} testId={`gls-row-${i}`}>
                  <ReportTd>{r.journalNumber}</ReportTd>
                  <ReportTd>{r.accountNumber}</ReportTd>
                  <ReportTd>{r.entryDate}</ReportTd>
                  <ReportTd>{r.source}</ReportTd>
                  <MoneyTd value={r.dr || null} />
                  <MoneyTd value={r.cr || null} />
                  <ReportTd>
                    <Btn data-testid={`gls-open-inquiry-${i}`} variant="secondary" size="sm" onClick={() => openInInquiry(r)}>
                      Open in GL Inquiry
                    </Btn>
                  </ReportTd>
                </ReportTr>
              ))}
            </tbody>
          </FinancialTable>
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center gap-3 mt-2 text-[13px]">
              <Btn data-testid="gls-prev-page" size="sm" variant="secondary" disabled={pagination.page <= 1} onClick={() => runSearch(pagination.page - 1)}>Previous</Btn>
              <span data-testid="gls-page-info" className="text-slate-500">Page {pagination.page} of {pagination.totalPages} ({pagination.totalResults} results)</span>
              <Btn data-testid="gls-next-page" size="sm" variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => runSearch(pagination.page + 1)}>Next</Btn>
            </div>
          )}

          <FilterBar>
            <FilterField label="Save this search as" width={220}>
              <input data-testid="gls-save-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <Btn data-testid="gls-save-button" size="sm" variant="secondary" onClick={doSave} disabled={saveBusy || !saveName.trim()} loading={saveBusy}>
              {saveBusy ? 'Saving…' : 'Save search'}
            </Btn>
          </FilterBar>
          {saveConflict && <Banner kind="error" testId="gls-save-conflict" title="Duplicate name">{saveConflict}</Banner>}
          {saveSuccess && <Banner kind="success" testId="gls-save-success" title="Search saved" />}
        </>
      )}

      {!results && !busy && !error && !validationError && !unauthorized && (
        <EmptyState testId="gls-initial-state" title="Enter search criteria and run a search." />
      )}

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-slate-900 mb-2">Saved Searches</h2>
        {savedLoading && <LoadingState testId="gls-saved-loading" label="Loading saved searches…" />}
        {savedError && <ErrorState testId="gls-saved-error" message={savedError} />}
        {deleteSuccess && <Banner kind="success" testId="gls-delete-success" title="Saved search deleted" />}
        {!savedLoading && savedSearches && savedSearches.length === 0 && (
          <EmptyState testId="gls-saved-empty" title="No saved searches yet" message="Run a search and save it to reuse it later." />
        )}
        {!savedLoading && savedSearches && savedSearches.length > 0 && (
          <FinancialTable testId="gls-saved-list" className="mt-2">
            <ReportThead>
              <tr>
                <ReportTh>Name</ReportTh>
                <ReportTh>Saved</ReportTh>
                <ReportTh align="right">Actions</ReportTh>
              </tr>
            </ReportThead>
            <tbody>
              {savedSearches.map((s, i) => (
                <ReportTr key={s.id} testId={`gls-saved-row-${i}`}>
                  <ReportTd className="font-medium" >
                    <span data-testid={`gls-saved-name-${i}`}>{s.name}</span>
                  </ReportTd>
                  <ReportTd>{s.createdAt.slice(0, 10)}</ReportTd>
                  <ReportTd align="right">
                    <div className="flex items-center gap-2 justify-end">
                      <Btn data-testid={`gls-saved-run-${i}`} size="sm" variant="secondary" onClick={() => doRunSaved(s)} disabled={busy}>Run</Btn>
                      {deleteConfirmId === s.id ? (
                        <span data-testid={`gls-delete-confirm-panel-${i}`} className="flex items-center gap-2">
                          <span className="text-slate-500">Delete &ldquo;{s.name}&rdquo;?</span>
                          <Btn data-testid={`gls-delete-confirm-yes-${i}`} size="sm" variant="danger" onClick={() => doDelete(s.id)} disabled={deleteBusy} loading={deleteBusy}>
                            {deleteBusy ? 'Deleting…' : 'Yes, delete'}
                          </Btn>
                          <Btn data-testid={`gls-delete-confirm-no-${i}`} size="sm" variant="ghost" onClick={() => setDeleteConfirmId(null)}>Cancel</Btn>
                        </span>
                      ) : (
                        <Btn data-testid={`gls-saved-delete-${i}`} size="sm" variant="ghost" onClick={() => setDeleteConfirmId(s.id)}>Delete</Btn>
                      )}
                    </div>
                  </ReportTd>
                </ReportTr>
              ))}
            </tbody>
          </FinancialTable>
        )}
      </section>

      <RelatedLinks
        links={[
          { label: 'Trial Balance', to: '/golden-path/trial-balance' },
          { label: 'Back to Journal Workflow', to: '/golden-path/journal' },
        ]}
      />
    </ReportShell>
  );
}

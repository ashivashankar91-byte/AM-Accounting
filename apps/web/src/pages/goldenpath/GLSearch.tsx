import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';
import { Banner, EmptyState, ErrorState, LoadingState, MoneyTd, UnauthorizedState } from '../../components/report';

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
    <div style={{ maxWidth: 1000, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>GL Search</h1>
      {error && <ErrorState testId="gls-error" message={error} />}
      {validationError && <ErrorState testId="gls-validation-error" message={validationError} />}
      {unauthorized && <UnauthorizedState testId="gls-unauthorized" message={unauthorized} />}

      <section style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Entity <input data-testid="gls-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)} style={{ width: 90 }} /></label>
        <label>Document/Control # <input data-testid="gls-docref" value={docRef} onChange={(e) => setDocRef(e.target.value)} style={{ width: 140 }} /></label>
        <label>Source <input data-testid="gls-source" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: 70 }} /></label>
        <label>Memo contains <input data-testid="gls-memo" value={memoContains} onChange={(e) => setMemoContains(e.target.value)} style={{ width: 160 }} /></label>
        <label>Posted by <input data-testid="gls-posted-by" value={postedBy} onChange={(e) => setPostedBy(e.target.value)} style={{ width: 100 }} /></label>
      </section>
      <section style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Amount <input data-testid="gls-amount" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 90 }} /></label>
        <label>Amount min <input data-testid="gls-amount-min" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} style={{ width: 90 }} /></label>
        <label>Amount max <input data-testid="gls-amount-max" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} style={{ width: 90 }} /></label>
        <label>
          Direction{' '}
          <select data-testid="gls-direction" value={direction} onChange={(e) => setDirection(e.target.value as '' | 'DEBIT' | 'CREDIT')}>
            <option value="">Any</option>
            <option value="DEBIT">Debit</option>
            <option value="CREDIT">Credit</option>
          </select>
        </label>
        <label>From <input data-testid="gls-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
        <label>To <input data-testid="gls-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        <button data-testid="gls-run" onClick={() => runSearch(1)} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </section>

      {busy && <LoadingState testId="gls-loading" label="Searching…" />}

      {results && results.length === 0 && (
        <EmptyState testId="gls-empty" title="No matching GL activity found" message="Widen the date range or clear a filter." />
      )}

      {results && results.length > 0 && (
        <>
          <table data-testid="gls-table" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Journal #</th>
                <th style={{ textAlign: 'left' }}>Account</th>
                <th>Date</th>
                <th>Source</th>
                <th>Debit</th>
                <th>Credit</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.journalEntryId}-${r.accountId}-${i}`} data-testid={`gls-row-${i}`}>
                  <td>{r.journalNumber}</td>
                  <td>{r.accountNumber}</td>
                  <td>{r.entryDate}</td>
                  <td>{r.source}</td>
                  <MoneyTd value={r.dr || null} />
                  <MoneyTd value={r.cr || null} />
                  <td>
                    <button data-testid={`gls-open-inquiry-${i}`} onClick={() => openInInquiry(r)}>Open in GL Inquiry</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination && pagination.totalPages > 1 && (
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button data-testid="gls-prev-page" disabled={pagination.page <= 1} onClick={() => runSearch(pagination.page - 1)}>Previous</button>
              <span data-testid="gls-page-info">Page {pagination.page} of {pagination.totalPages} ({pagination.totalResults} results)</span>
              <button data-testid="gls-next-page" disabled={pagination.page >= pagination.totalPages} onClick={() => runSearch(pagination.page + 1)}>Next</button>
            </div>
          )}

          <section style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
            <label>Save this search as <input data-testid="gls-save-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} style={{ width: 200 }} /></label>
            <button data-testid="gls-save-button" onClick={doSave} disabled={saveBusy || !saveName.trim()}>{saveBusy ? 'Saving…' : 'Save search'}</button>
          </section>
          {saveConflict && <Banner kind="error" testId="gls-save-conflict" title="Duplicate name">{saveConflict}</Banner>}
          {saveSuccess && <Banner kind="success" testId="gls-save-success" title="Search saved" />}
        </>
      )}

      {!results && !busy && !error && !validationError && !unauthorized && (
        <EmptyState testId="gls-initial-state" title="Enter search criteria and run a search." />
      )}

      <section style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Saved Searches</h2>
        {savedLoading && <LoadingState testId="gls-saved-loading" label="Loading saved searches…" />}
        {savedError && <ErrorState testId="gls-saved-error" message={savedError} />}
        {deleteSuccess && <Banner kind="success" testId="gls-delete-success" title="Saved search deleted" />}
        {!savedLoading && savedSearches && savedSearches.length === 0 && (
          <EmptyState testId="gls-saved-empty" title="No saved searches yet" message="Run a search and save it to reuse it later." />
        )}
        {!savedLoading && savedSearches && savedSearches.length > 0 && (
          <table data-testid="gls-saved-list" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Name</th>
                <th style={{ textAlign: 'left' }}>Saved</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {savedSearches.map((s, i) => (
                <tr key={s.id} data-testid={`gls-saved-row-${i}`}>
                  <td data-testid={`gls-saved-name-${i}`}>{s.name}</td>
                  <td>{s.createdAt.slice(0, 10)}</td>
                  <td>
                    <button data-testid={`gls-saved-run-${i}`} onClick={() => doRunSaved(s)} disabled={busy}>Run</button>
                    {' '}
                    {deleteConfirmId === s.id ? (
                      <span data-testid={`gls-delete-confirm-panel-${i}`}>
                        Delete &ldquo;{s.name}&rdquo;?{' '}
                        <button data-testid={`gls-delete-confirm-yes-${i}`} onClick={() => doDelete(s.id)} disabled={deleteBusy}>
                          {deleteBusy ? 'Deleting…' : 'Yes, delete'}
                        </button>{' '}
                        <button data-testid={`gls-delete-confirm-no-${i}`} onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                      </span>
                    ) : (
                      <button data-testid={`gls-saved-delete-${i}`} onClick={() => setDeleteConfirmId(s.id)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/trial-balance">Trial Balance</Link>
        {' · '}
        <Link to="/golden-path/journal">Back to Journal Workflow</Link>
      </p>
    </div>
  );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { goldenPathApi } from '../../api/client';

interface GLSearchResultRow {
  journalEntryId: string;
  journalNumber: string;
  accountId: string;
  accountNumber: string;
  entryDate: string;
  source: string;
  store: string | null;
  dept: string | null;
  controlNumber: string | null;
  applyNumber: string | null;
  memo: string | null;
  dr: number;
  cr: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// FINAL-R0 / S221 — GL Search Screen. Consumes the real coa-service
// GET /api/v1/coa/inquiry/search API as-is (frozen S220 ActivityLineView
// contract) -- no client-side filtering or recomputation of the returned
// rows.
export default function GLSearch() {
  const [docRef, setDocRef] = useState('');
  const [source, setSource] = useState('');
  const [memoContains, setMemoContains] = useState('');
  const [results, setResults] = useState<GLSearchResultRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSearch() {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      // Golden R0 closure defect fix: this field previously sent
      // `journalNumber`, a param name that does not exist in the real
      // coa-service SearchQuerySchema (services/coa-service/src/http/
      // gl-search-routes.ts) -- Zod silently drops unknown keys, so the
      // filter was a no-op that always searched everything regardless of
      // what was typed here. Switched to the real `docRef` schema field
      // (document/control-number search) so this input actually filters.
      const res = await goldenPathApi.searchGL({
        docRef: docRef || undefined,
        sourceCode: source || undefined,
        memoContains: memoContains || undefined,
      });
      setResults(res.results);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>GL Search</h1>
      {error && <p data-testid="gls-error" style={{ color: '#b91c1c' }}>{error}</p>}

      <section style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Document/Control # <input data-testid="gls-docref" value={docRef} onChange={(e) => setDocRef(e.target.value)} style={{ width: 160 }} /></label>
        <label>Source <input data-testid="gls-source" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: 70 }} /></label>
        <label>Memo contains <input data-testid="gls-memo" value={memoContains} onChange={(e) => setMemoContains(e.target.value)} style={{ width: 160 }} /></label>
        <button data-testid="gls-run" onClick={runSearch} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </section>

      {results && (
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
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.journalEntryId}-${r.accountId}-${i}`} data-testid={`gls-row-${i}`}>
                  <td>{r.journalNumber}</td>
                  <td>{r.accountNumber}</td>
                  <td>{r.entryDate}</td>
                  <td>{r.source}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(r.dr)}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{fmt(r.cr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && <p data-testid="gls-empty">No matching GL activity found.</p>}
        </>
      )}

      <p style={{ marginTop: 24 }}>
        <Link to="/golden-path/trial-balance">Trial Balance</Link>
        {' · '}
        <Link to="/golden-path/journal">Back to Journal Workflow</Link>
      </p>
    </div>
  );
}

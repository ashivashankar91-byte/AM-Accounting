import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { goldenPathApi } from '../../api/client';

interface Line {
  accountId: string;
  storeId: string;
  deptCode: string;
  dr: string;
  cr: string;
  memo: string;
}

const emptyLine = (): Line => ({ accountId: '', storeId: '', deptCode: '', dr: '', cr: '', memo: '' });

// FINAL-R0 Golden Path steps 6-9: journal draft -> validate -> post -> view,
// wired to the real coa-service draft/journal endpoints (S214/S215/S216)
// through the real gateway. Step 10 (reverse) lives on the same page once a
// journal has been posted.
export default function JournalWorkflow() {
  const { legalEntityId } = useAuth();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [stores, setStores] = useState<any[]>([]);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('Golden Path journal entry');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<string | null>(null);
  const [validation, setValidation] = useState<any>(null);
  const [journal, setJournal] = useState<any>(null);
  const [reversal, setReversal] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!legalEntityId) return;
    goldenPathApi.listAccounts(legalEntityId).then((r) => setAccounts(r.accounts.filter((a) => a.postable)));
    goldenPathApi.listStores(legalEntityId).then((r) => setStores(r.items));
  }, [legalEntityId]);

  if (!legalEntityId) {
    return (
      <div style={{ margin: 40 }}>
        <p>No legal entity selected.</p>
        <Link to="/golden-path/select-entity">Select a legal entity</Link>
      </div>
    );
  }

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function createDraft() {
    setError(null);
    setBusy(true);
    try {
      const result = await goldenPathApi.createDraft({
        entityId: legalEntityId!,
        entryDate,
        sourceCode: 'ADJ',
        memo,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          storeId: l.storeId,
          deptCode: l.deptCode || null,
          dr: l.dr ? Number(l.dr) : 0,
          cr: l.cr ? Number(l.cr) : 0,
          memo: l.memo || null,
        })),
      });
      setDraftId(result.draftId);
      setDraftStatus(result.status);
      setValidation(null);
      setJournal(null);
      setReversal(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function validateDraft() {
    if (!draftId) return;
    setError(null);
    setBusy(true);
    try {
      const result = await goldenPathApi.validateDraft(draftId);
      setValidation(result);
      const d = await goldenPathApi.getDraft(draftId);
      setDraftStatus(d.status);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function postDraft() {
    if (!draftId) return;
    setError(null);
    setBusy(true);
    try {
      const result = await goldenPathApi.postDraft(draftId);
      const view = await goldenPathApi.getJournal(result.journalNumber);
      setJournal(view);
      setDraftStatus('POSTED');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reverseJournal() {
    if (!journal) return;
    setError(null);
    setBusy(true);
    try {
      const result = await goldenPathApi.reverseJournal(journal.id, 'Golden Path E2E reversal');
      setReversal(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', fontFamily: 'Inter, sans-serif' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Journal Entry — Draft → Validate → Post → View → Reverse</h1>
      {error && <p data-testid="journal-error" style={{ color: '#b91c1c' }}>{error}</p>}

      <section style={{ marginTop: 16 }}>
        <label>Entry date <input data-testid="journal-entry-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></label>
        <label style={{ marginLeft: 12 }}>Memo <input data-testid="journal-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></label>

        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }} data-testid={`journal-line-${i}`}>
            <select data-testid={`journal-line-${i}-account`} value={line.accountId} onChange={(e) => updateLine(i, { accountId: e.target.value })}>
              <option value="">Account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountNumber} {a.name}</option>)}
            </select>
            <select data-testid={`journal-line-${i}-store`} value={line.storeId} onChange={(e) => updateLine(i, { storeId: e.target.value })}>
              <option value="">Store…</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.storeCode ?? s.code ?? s.id}</option>)}
            </select>
            <input data-testid={`journal-line-${i}-dept`} placeholder="Dept" value={line.deptCode} onChange={(e) => updateLine(i, { deptCode: e.target.value })} style={{ width: 60 }} />
            <input data-testid={`journal-line-${i}-dr`} placeholder="Debit" value={line.dr} onChange={(e) => updateLine(i, { dr: e.target.value })} style={{ width: 80 }} />
            <input data-testid={`journal-line-${i}-cr`} placeholder="Credit" value={line.cr} onChange={(e) => updateLine(i, { cr: e.target.value })} style={{ width: 80 }} />
          </div>
        ))}

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button data-testid="journal-create-draft" onClick={createDraft} disabled={busy}>1. Save Draft</button>
          <button data-testid="journal-validate" onClick={validateDraft} disabled={busy || !draftId}>2. Validate</button>
          <button data-testid="journal-post" onClick={postDraft} disabled={busy || !draftId}>3. Post</button>
          <button data-testid="journal-reverse" onClick={reverseJournal} disabled={busy || !journal}>4. Reverse</button>
        </div>
      </section>

      {draftId && <p data-testid="journal-draft-status">Draft {draftId} — status: {draftStatus}</p>}
      {validation && (
        // BR013-1 fix: render the real backend-provided validation reason(s)
        // and amounts instead of only the pass/fail boolean. All numbers and
        // messages below (rule, message, lineIndex, deltaDr, deltaCr) come
        // straight from the coa-service /validate response
        // (draft-service.ts's ValidationResult) -- the browser performs no
        // validation math of its own.
        <div data-testid="journal-validation-result" style={{ marginTop: 8 }}>
          <p>Validation pass: {String(validation.pass)}</p>
          {!validation.pass && Array.isArray(validation.errors) && validation.errors.length > 0 && (
            <ul data-testid="journal-validation-errors">
              {validation.errors.map((e: any, idx: number) => (
                <li key={idx} data-testid="journal-validation-error">
                  {e.lineIndex !== undefined ? `Line ${e.lineIndex + 1}: ` : ''}
                  {e.message ?? e.rule}
                  {e.rule && e.message ? ` (${e.rule})` : ''}
                </li>
              ))}
            </ul>
          )}
          {(validation.deltaDr !== undefined || validation.deltaCr !== undefined) && (
            <p data-testid="journal-validation-delta">
              Debits ({Number(validation.deltaDr ?? 0).toFixed(2)}) must equal credits ({Number(validation.deltaCr ?? 0).toFixed(2)})
            </p>
          )}
        </div>
      )}
      {journal && (
        <div data-testid="journal-view" style={{ marginTop: 16, border: '1px solid #ddd', padding: 12 }}>
          <div>Journal {journal.journalNumber} — status {journal.status} — {journal.totalDebits} DR / {journal.totalCredits} CR</div>
        </div>
      )}
      {reversal && <p data-testid="journal-reversal-result">Reversed as {reversal.journalNumber ?? reversal.id}</p>}

      {journal && (
        <button
          data-testid="journal-continue-audit"
          style={{ marginTop: 24 }}
          onClick={() => navigate(`/golden-path/audit/JOURNAL_ENTRY/${journal.id}`)}
        >
          View Audit History
        </button>
      )}

      <p style={{ marginTop: 16 }}>
        <Link to="/golden-path/trial-balance" data-testid="journal-go-to-trial-balance">
          Trial Balance report (S222)
        </Link>
      </p>
    </div>
  );
}

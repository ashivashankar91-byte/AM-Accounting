import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { cashDrawerApi } from '../../../api/client';
import { Banner, ErrorState, LoadingState, UnauthorizedState, ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS } from '../../../components/report';
import { Btn } from '../../../components/ui';

// BR: the cashier must not see expected cash, expected checks, expected
// receipt count, or variance before submission. This screen never fetches
// or renders any of that — the backend's blind-close response deliberately
// omits it too (defense in depth, not just a UI convention).
export default function BlindClose() {
  const { drawerId } = useParams<{ drawerId: string }>();
  const navigate = useNavigate();

  const [drawer, setDrawer] = useState<any>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  const [countedCash, setCountedCash] = useState('');
  const [checkCount, setCheckCount] = useState('0');
  const [checkTotal, setCheckTotal] = useState('0.00');
  const [retainedFloat, setRetainedFloat] = useState('');
  const [cashierNote, setCashierNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<any>(null);

  useEffect(() => {
    if (!drawerId) return;
    setPageLoading(true);
    setPageError(null);
    setUnauthorized(null);
    cashDrawerApi
      .getDrawer(drawerId)
      .then(setDrawer)
      .catch((err: any) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setPageError(err.message);
      })
      .finally(() => setPageLoading(false));
  }, [drawerId]);

  const canSubmit = Boolean(drawer && drawer.status === 'OPEN' && countedCash !== '' && retainedFloat !== '' && !busy);

  async function submit() {
    if (!drawerId) return;
    setError(null);
    setBusy(true);
    try {
      const result = await cashDrawerApi.submitBlindClose(drawerId, {
        countedCash, checkCount: Number(checkCount) || 0, checkTotal, retainedFloat, cashierNote: cashierNote.trim() || null,
      });
      setConfirmation(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (unauthorized) return <UnauthorizedState testId="blind-close-unauthorized" message={unauthorized} />;
  if (pageError) return <ErrorState testId="blind-close-page-error" message={pageError} onRetry={() => window.location.reload()} />;
  if (pageLoading) return <LoadingState testId="blind-close-loading" label="Loading drawer…" />;

  if (confirmation) {
    return (
      <ReportShell title="Blind Close Submitted">
        <Banner kind="success" title="Blind count submitted" testId="blind-close-confirmation">
          Your count has been recorded. A supervisor will review and reconcile this drawer — you will not see the
          expected totals or any variance from this screen.
        </Banner>
        <div className="mt-3"><Btn onClick={() => navigate('/accounting/cash')}>Back to Drawer</Btn></div>
      </ReportShell>
    );
  }

  return (
    <ReportShell title="Blind Drawer Close" description="Count your drawer and submit. Expected totals are never shown here.">
      {drawer && drawer.status !== 'OPEN' && (
        <Banner kind="warning" title="This drawer already has a blind count" testId="blind-close-already-submitted">
          Blind close can only be submitted once, while the drawer is open.
        </Banner>
      )}

      {drawer && drawer.status === 'OPEN' && (
        <div className="bg-white border border-slate-200 rounded-md p-5 max-w-xl">
          <FilterBar>
            <FilterField label="Counted cash" width={140}>
              <input data-testid="blind-close-cash" type="number" step="0.01" min="0" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
            </FilterField>
            <FilterField label="Check count" width={110}>
              <input data-testid="blind-close-check-count" type="number" min="0" value={checkCount} onChange={(e) => setCheckCount(e.target.value)} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
            </FilterField>
            <FilterField label="Check total" width={140}>
              <input data-testid="blind-close-check-total" type="number" step="0.01" min="0" value={checkTotal} onChange={(e) => setCheckTotal(e.target.value)} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
            </FilterField>
          </FilterBar>
          <FilterBar>
            <FilterField label="Retained closing float" width={180}>
              <input data-testid="blind-close-retained-float" type="number" step="0.01" min="0" value={retainedFloat} onChange={(e) => setRetainedFloat(e.target.value)} className={`${FILTER_CONTROL_CLASS} font-mono text-right`} />
            </FilterField>
          </FilterBar>
          <FilterField label="Note (optional)">
            <textarea data-testid="blind-close-note" value={cashierNote} onChange={(e) => setCashierNote(e.target.value)} className="w-full h-16 border border-slate-300 rounded-md p-2 text-[13px] mb-3" />
          </FilterField>

          {error && <ErrorState testId="blind-close-error" message={error} />}

          <Btn data-testid="blind-close-submit" onClick={submit} disabled={!canSubmit} loading={busy}>Submit Blind Close</Btn>
        </div>
      )}
    </ReportShell>
  );
}

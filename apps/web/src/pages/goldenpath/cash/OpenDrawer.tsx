import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { cashDrawerApi, goldenPathApi } from '../../../api/client';
import { ErrorState, LoadingState, UnauthorizedState, ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS } from '../../../components/report';
import { Btn } from '../../../components/ui';

export default function OpenDrawer() {
  const { legalEntityId } = useAuth();
  const navigate = useNavigate();

  const [stores, setStores] = useState<any[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  const [storeId, setStoreId] = useState('');
  const [terminalCode, setTerminalCode] = useState('');
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [openingFloat, setOpeningFloat] = useState('100.00');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!legalEntityId) return;
    setPageLoading(true);
    setPageError(null);
    setUnauthorized(null);
    goldenPathApi
      .listStores(legalEntityId)
      .then((res) => setStores(res.items))
      .catch((err: any) => {
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setPageError(err.message);
      })
      .finally(() => setPageLoading(false));
  }, [legalEntityId]);

  const selectedStore = stores.find((s) => s.id === storeId);
  const canSubmit = Boolean(storeId && terminalCode.trim() && businessDate && openingFloat !== '' && !busy);

  async function submit() {
    if (!selectedStore) return;
    setError(null);
    setBusy(true);
    try {
      const drawer = await cashDrawerApi.openDrawer({
        storeId: selectedStore.id,
        storeCode: selectedStore.storeCode ?? selectedStore.code ?? selectedStore.id,
        terminalCode: terminalCode.trim().toUpperCase(),
        entityId: legalEntityId!,
        businessDate,
        openingFloat,
      });
      navigate(`/accounting/cash?opened=${drawer.id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReportShell title="Open Drawer" description="Start a new cashier drawer session for this business date.">
      {unauthorized && <UnauthorizedState testId="open-drawer-unauthorized" message={unauthorized} />}
      {pageError && <ErrorState testId="open-drawer-page-error" message={pageError} onRetry={() => window.location.reload()} />}
      {pageLoading && <LoadingState testId="open-drawer-loading" label="Loading stores…" />}

      {!pageLoading && !unauthorized && !pageError && (
        <div className="bg-white border border-slate-200 rounded-md p-5 max-w-xl">
          <FilterBar>
            <FilterField label="Store" width={220}>
              <select data-testid="open-drawer-store" value={storeId} onChange={(e) => setStoreId(e.target.value)} className={FILTER_CONTROL_CLASS}>
                <option value="">Select a store…</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.storeCode ?? s.code ?? s.id}{s.storeName ? ` — ${s.storeName}` : ''}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Terminal" width={160}>
              <input
                data-testid="open-drawer-terminal"
                value={terminalCode}
                onChange={(e) => setTerminalCode(e.target.value)}
                placeholder="e.g. TERM1"
                className={FILTER_CONTROL_CLASS}
              />
            </FilterField>
            <FilterField label="Business date" width={160}>
              <input data-testid="open-drawer-date" type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className={FILTER_CONTROL_CLASS} />
            </FilterField>
            <FilterField label="Opening float" width={140}>
              <input
                data-testid="open-drawer-float"
                type="number" step="0.01" min="0"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                className={`${FILTER_CONTROL_CLASS} font-mono text-right`}
              />
            </FilterField>
          </FilterBar>

          {stores.length === 0 && (
            <p className="text-[12.5px] text-slate-500 mb-3">No stores are configured for this legal entity yet.</p>
          )}

          {error && <ErrorState testId="open-drawer-error" message={error} />}

          <Btn data-testid="open-drawer-submit" onClick={submit} disabled={!canSubmit} loading={busy}>
            Open Drawer
          </Btn>
        </div>
      )}
    </ReportShell>
  );
}

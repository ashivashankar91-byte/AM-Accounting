import { useState } from 'react';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { partsApi } from '../../../api/partsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState, Drawer, DrawerRow,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

const STATUS_VARIANT: Record<string, 'neutral' | 'warning' | 'success' | 'danger'> = {
  OPEN: 'neutral', FROZEN: 'warning', COUNTED: 'warning', VARIANCE_REVIEW: 'warning', APPROVED: 'success', POSTED: 'success',
};

// CE-11 / S069 — Parts Physical Inventory. Session lifecycle: open (freeze
// scope, optional blind count) -> freeze (snapshots perpetual qty/value) ->
// count-line entry -> variance report -> threshold-gated approval -> one
// posted adjustment journal. Unapproved counts change nothing. Permission:
// parts.physical.count / parts.physical.approve.
export default function PartsPhysicalInventory() {
  const { entityId: contextEntityId, entityLabel, storeId: contextStoreId } = useEntityScope();
  const [sessions, setSessions] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  // New-session form
  const [scopeDescription, setScopeDescription] = useState('');
  const [storeId, setStoreId] = useState(contextStoreId ?? '');
  const [blindCount, setBlindCount] = useState(false);
  const [varianceThreshold, setVarianceThreshold] = useState('');

  // Count-line entry state
  const [countPart, setCountPart] = useState('');
  const [countQty, setCountQty] = useState('');

  async function load() {
    if (!contextEntityId) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null); setUnauthorized(null);
    try {
      const res = await partsApi.listPhysicalSessions(contextEntityId);
      setSessions(res.items);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else setError(err.message);
    } finally { setBusy(false); }
  }

  async function openSession() {
    if (!contextEntityId || !storeId.trim() || !scopeDescription.trim()) { setError('Legal entity, store, and scope description are required.'); return; }
    setBusy(true); setError(null);
    try {
      const session = await partsApi.openPhysicalSession({
        legalEntityId: contextEntityId, storeId: storeId.trim(), scopeDescription: scopeDescription.trim(),
        blindCount, varianceThreshold: varianceThreshold || undefined,
      });
      setSessions((prev) => [session, ...prev]);
      setSelected(session);
      setScopeDescription('');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function viewSession(id: string) {
    if (!contextEntityId) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null);
    try { setSelected(await partsApi.getPhysicalSession(id, contextEntityId)); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function freeze() {
    if (!selected || !contextEntityId) return;
    setBusy(true); setError(null);
    try { setSelected(await (async () => { await partsApi.freezePhysicalSession(selected.id, [], contextEntityId); return partsApi.getPhysicalSession(selected.id, contextEntityId); })()); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function enterCount() {
    if (!selected || !countPart.trim() || !countQty.trim() || !contextEntityId) return;
    setBusy(true); setError(null);
    try {
      const updated = await partsApi.enterCountLines(selected.id, [{ partNumber: countPart.trim(), countedQty: countQty.trim() }], contextEntityId);
      setSelected(updated);
      setCountPart(''); setCountQty('');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function computeVariance() {
    if (!selected || !contextEntityId) return;
    setBusy(true); setError(null);
    try { setSelected(await partsApi.varianceReport(selected.id, contextEntityId)); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function approve() {
    if (!selected || !contextEntityId) return;
    setBusy(true); setError(null);
    try {
      const result = await partsApi.approvePhysicalSession(selected.id, { legalEntityId: contextEntityId, correlationId: crypto.randomUUID(), businessDate: new Date().toISOString().slice(0, 10) });
      setSelected(result);
      setSessions((prev) => prev.map((s) => (s.id === result.id ? result : s)));
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <ReportShell
      title="Physical Inventory Adjustment Review"
      description="Count sessions, variance review, threshold-gated approval, posted-adjustment linkage. Unapproved counts change nothing in GL or perpetual."
      scopeFields={[{ label: 'Legal entity', value: entityLabel ?? contextEntityId ?? 'Not selected', muted: !contextEntityId }]}
      actions={<Btn size="sm" variant="secondary" onClick={load} disabled={busy} data-testid="physical-refresh">Refresh</Btn>}
    >
      <div className="border border-slate-200 rounded-lg p-3 mb-4 bg-slate-50">
        <div className="text-xs font-semibold text-slate-600 mb-2">New count session</div>
        <FilterBar>
          <FilterField label="Store" width={120}>
            <input className={FILTER_CONTROL_CLASS} value={storeId} onChange={(e) => setStoreId(e.target.value)} data-testid="physical-new-store" />
          </FilterField>
          <FilterField label="Scope description" width={220}>
            <input className={FILTER_CONTROL_CLASS} value={scopeDescription} onChange={(e) => setScopeDescription(e.target.value)} placeholder="e.g. Bin aisle 3-7" data-testid="physical-new-scope" />
          </FilterField>
          <FilterField label="Variance threshold" width={140}>
            <input className={FILTER_CONTROL_CLASS} value={varianceThreshold} onChange={(e) => setVarianceThreshold(e.target.value)} placeholder="0.00 (optional)" data-testid="physical-new-threshold" />
          </FilterField>
          <FilterField label="Blind count" width={100}>
            <label className="flex items-center gap-1.5 h-8 text-xs">
              <input type="checkbox" checked={blindCount} onChange={(e) => setBlindCount(e.target.checked)} data-testid="physical-new-blind" /> Blind
            </label>
          </FilterField>
          <Btn size="sm" onClick={openSession} disabled={busy} data-testid="physical-open-session">Open session</Btn>
        </FilterBar>
      </div>

      {error && <ErrorState testId="physical-error" message={error} onRetry={load} />}
      {unauthorized && <UnauthorizedState testId="physical-unauthorized" message={unauthorized} />}
      {busy && <LoadingState testId="physical-loading" label="Loading…" />}

      {!busy && sessions.length === 0 && !error && !unauthorized && (
        <EmptyState testId="physical-empty" title="No physical inventory sessions yet" message="Open a session above, or press Refresh." />
      )}

      {sessions.length > 0 && (
        <FinancialTable testId="physical-sessions-table">
          <ReportThead>
            <tr>
              <ReportTh>Scope</ReportTh>
              <ReportTh>Store</ReportTh>
              <ReportTh>Blind</ReportTh>
              <ReportTh>Status</ReportTh>
              <ReportTh>Journal</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {sessions.map((s) => (
              <ReportTr key={s.id} testId={`physical-session-row-${s.id}`} onClick={() => viewSession(s.id)}>
                <ReportTd>{s.scopeDescription}</ReportTd>
                <ReportTd className="font-mono">{s.storeId}</ReportTd>
                <ReportTd>{s.blindCount ? 'Yes' : 'No'}</ReportTd>
                <ReportTd><Badge variant={STATUS_VARIANT[s.status] ?? 'neutral'} dot>{s.status.replace(/_/g, ' ')}</Badge></ReportTd>
                <ReportTd className="font-mono">{s.journalEntryId ? s.journalEntryId : '—'}</ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}

      {selected && (
        <Drawer open title={`Session — ${selected.scopeDescription}`} onClose={() => setSelected(null)} testId="physical-session-drawer">
          <DrawerRow label="Status" value={<Badge variant={STATUS_VARIANT[selected.status] ?? 'neutral'} dot>{selected.status.replace(/_/g, ' ')}</Badge>} />
          <DrawerRow label="Blind count" value={selected.blindCount ? 'Yes — perpetual quantities hidden from counters until approval' : 'No'} />

          {selected.status === 'OPEN' && (
            <div className="mt-3">
              <Btn size="sm" onClick={freeze} disabled={busy} data-testid="physical-freeze">Freeze scope &amp; snapshot perpetual</Btn>
            </div>
          )}

          {(selected.status === 'FROZEN' || selected.status === 'COUNTED') && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <div className="text-xs font-semibold text-slate-600 mb-2">Enter count</div>
              <div className="flex gap-2 items-end">
                <div>
                  <label className="text-xs text-slate-500">Part #</label>
                  <input className={FILTER_CONTROL_CLASS} value={countPart} onChange={(e) => setCountPart(e.target.value)} data-testid="physical-count-part" />
                </div>
                <div>
                  <label className="text-xs text-slate-500">Counted qty</label>
                  <input className={FILTER_CONTROL_CLASS} value={countQty} onChange={(e) => setCountQty(e.target.value)} data-testid="physical-count-qty" />
                </div>
                <Btn size="sm" onClick={enterCount} disabled={busy} data-testid="physical-count-submit">Add</Btn>
              </div>
              {!selected.blindCount && (
                <div className="text-[11px] text-slate-500 mt-1">Perpetual snapshot is visible to reviewers (blind count is off).</div>
              )}
              <Btn size="sm" variant="secondary" className="mt-3" onClick={computeVariance} disabled={busy} data-testid="physical-variance-report">Compute variance report</Btn>
            </div>
          )}

          {Array.isArray(selected.lines) && selected.lines.length > 0 && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <div className="text-xs font-semibold text-slate-600 mb-2">Count lines</div>
              <FinancialTable testId="physical-count-lines-table">
                <ReportThead>
                  <tr>
                    <ReportTh>Part</ReportTh>
                    <ReportTh align="right">Perpetual (snapshot)</ReportTh>
                    <ReportTh align="right">Counted</ReportTh>
                    <ReportTh align="right">Variance</ReportTh>
                  </tr>
                </ReportThead>
                <tbody>
                  {selected.lines.map((l: any) => (
                    <ReportTr key={l.id}>
                      <ReportTd className="font-mono">{l.partNumber}</ReportTd>
                      <ReportTd align="right" className="font-mono tabular-nums">{l.perpetualQtySnapshot ?? '(hidden — blind count)'}</ReportTd>
                      <ReportTd align="right" className="font-mono tabular-nums">{l.countedQty ?? '—'}</ReportTd>
                      <ReportTd align="right" className={`font-mono tabular-nums ${l.varianceQty && Number(l.varianceQty) !== 0 ? 'text-red-700 font-semibold' : ''}`}>{l.varianceQty ?? '—'}</ReportTd>
                    </ReportTr>
                  ))}
                </tbody>
              </FinancialTable>
            </div>
          )}

          {selected.status === 'VARIANCE_REVIEW' && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <Banner kind="warning" testId="physical-approval-banner" title="Approval posts exactly the reviewed variance — one journal, corrects perpetual">
                Review the variance lines above before approving. Approval is the only action that posts to GL.
              </Banner>
              <Btn size="sm" onClick={approve} disabled={busy} data-testid="physical-approve">Approve &amp; post adjustment</Btn>
            </div>
          )}

          {selected.status === 'POSTED' && (
            <div className="mt-3 border-t border-slate-200 pt-3 text-xs">
              Posted — journal <span className="font-mono">{selected.journalEntryId}</span>
            </div>
          )}
        </Drawer>
      )}
    </ReportShell>
  );
}

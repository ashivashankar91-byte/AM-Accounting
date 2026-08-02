import { useState } from 'react';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { partsApi } from '../../../api/partsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState,
} from '../../../components/report';
import { Btn, Badge } from '../../../components/ui';

// CE-11 / S067, S068, S072 — Price-Tape / Revaluation & Obsolescence, plus
// the S072 valuation-config tab. Preview-approve discipline throughout:
// nothing auto-posts on tape load or provision preview, only an explicit
// approval ceremony calls the posting engine, and approved totals must
// equal preview totals exactly.
export default function PartsValuation() {
  const { entityId: contextEntityId, entityLabel } = useEntityScope();
  const [tab, setTab] = useState<'tape' | 'obsolescence' | 'config'>('tape');

  return (
    <ReportShell
      title="Price-Tape / Revaluation & Obsolescence"
      description="OEM price-tape revaluation (preview-approve), obsolescence provisioning and scrap, and the S072 valuation-method configuration tape/S066 reads."
      scopeFields={[{ label: 'Legal entity', value: entityLabel ?? contextEntityId ?? 'Not selected', muted: !contextEntityId }]}
    >
      <div className="flex gap-4 mb-3 border-b border-slate-200">
        {(['tape', 'obsolescence', 'config'] as const).map((t) => (
          <button key={t} className={`pb-2 text-xs font-medium border-b-2 ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`} onClick={() => setTab(t)} data-testid={`valuation-tab-${t}`}>
            {t === 'tape' ? 'Price tape' : t === 'obsolescence' ? 'Obsolescence & scrap' : 'Valuation config (S072)'}
          </button>
        ))}
      </div>
      {tab === 'tape' && <PriceTapeTab entityId={contextEntityId} />}
      {tab === 'obsolescence' && <ObsolescenceTab entityId={contextEntityId} />}
      {tab === 'config' && <ConfigTab entityId={contextEntityId} />}
    </ReportShell>
  );
}

interface TapeLineDraft { partNumber: string; oldValue: string; newValue: string; qtyOnHand: string; effectiveFrom: string; }

function directionOf(total: string | number | null | undefined): 'UP' | 'DOWN' | null {
  if (total === null || total === undefined) return null;
  const n = Number(total);
  if (!Number.isFinite(n) || n === 0) return null;
  return n < 0 ? 'DOWN' : 'UP';
}

function PriceTapeTab({ entityId }: { entityId: string | null }) {
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const [loadBatchId, setLoadBatchId] = useState('');
  const [lines, setLines] = useState<TapeLineDraft[]>([]);
  const [linePart, setLinePart] = useState('');
  const [lineOld, setLineOld] = useState('');
  const [lineNew, setLineNew] = useState('');
  const [lineQty, setLineQty] = useState('');
  const [lineEffective, setLineEffective] = useState(todayIso());
  const [tapes, setTapes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [mappingUnavailable, setMappingUnavailable] = useState<string | null>(null);

  async function load() {
    if (!entityId) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null); setUnauthorized(null); setMappingUnavailable(null);
    try { setTapes((await partsApi.listPriceTapes(entityId)).items); }
    catch (err: any) { if (err.status === 401 || err.status === 403) setUnauthorized(err.message); else setError(err.message); }
    finally { setBusy(false); }
  }

  function addLine() {
    if (!linePart.trim() || !lineOld.trim() || !lineNew.trim() || !lineQty.trim()) return;
    setLines((prev) => [...prev, { partNumber: linePart.trim(), oldValue: lineOld.trim(), newValue: lineNew.trim(), qtyOnHand: lineQty.trim(), effectiveFrom: lineEffective }]);
    setLinePart(''); setLineOld(''); setLineNew(''); setLineQty('');
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function createLoad() {
    // A tape with zero lines has a $0 total — coa-service's posting engine
    // refuses any non-positive baseAmountPath, so approval would always
    // fail downstream. Require at least one real revaluation line here,
    // rather than letting an empty tape reach approval and fail loudly
    // later for a reason the user can't see from this screen.
    if (!entityId || !loadBatchId.trim() || lines.length === 0) return;
    setBusy(true); setError(null);
    try {
      await partsApi.loadPriceTape({
        legalEntityId: entityId, loadBatchId: loadBatchId.trim(),
        lines: lines.map((l) => ({ partNumber: l.partNumber, oldValue: l.oldValue, newValue: l.newValue, qtyOnHand: l.qtyOnHand, effectiveFrom: l.effectiveFrom })),
      });
      setLoadBatchId(''); setLines([]);
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function preview(id: string) {
    if (!entityId) return;
    setBusy(true); setError(null);
    try { setSelected(await partsApi.previewPriceTape(id, entityId)); await load(); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function approve(id: string) {
    if (!entityId) return;
    setBusy(true); setError(null); setMappingUnavailable(null);
    try {
      const result = await partsApi.approvePriceTape(id, { legalEntityId: entityId, correlationId: crypto.randomUUID(), businessDate: new Date().toISOString().slice(0, 10) });
      setSelected(result);
      await load();
    } catch (err: any) {
      // Missing-mapping is an explicit, named unavailable state — never a
      // fabricated result or a generic error, mirroring
      // PartsReconciliation.tsx's ACCOUNT_MAPPING_VALUES_PENDING handling.
      if (err.body?.error === 'ACCOUNT_MAPPING_VALUES_PENDING') {
        setMappingUnavailable(`The PRICE_TAPE_REVALUATION account mapping is not yet configured for this legal entity (${err.message}). Resolve the mapping before approving.`);
      } else setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <Banner kind="info" testId="pricetape-noauto-banner" title="Nothing auto-posts on tape load — preview then explicit approval only">
        A loaded tape has zero GL effect until an authorized user runs the approval ceremony below. Approved total must equal the preview total exactly. Both upward AND downward revaluations are supported — the direction is computed from the lines below, never entered manually.
      </Banner>

      <div className="border border-slate-200 rounded-lg p-3 mb-4 bg-slate-50">
        <div className="text-xs font-semibold text-slate-600 mb-2">New price-tape load</div>
        <FilterBar>
          <FilterField label="Load batch ID" width={180}>
            <input className={FILTER_CONTROL_CLASS} value={loadBatchId} onChange={(e) => setLoadBatchId(e.target.value)} data-testid="pricetape-new-batch" />
          </FilterField>
        </FilterBar>
        <div className="text-xs font-semibold text-slate-600 mt-3 mb-2">Add a revaluation line</div>
        <FilterBar>
          <FilterField label="Part #" width={130}>
            <input className={FILTER_CONTROL_CLASS} value={linePart} onChange={(e) => setLinePart(e.target.value)} data-testid="pricetape-line-part" />
          </FilterField>
          <FilterField label="Old value" width={100}>
            <input className={FILTER_CONTROL_CLASS} value={lineOld} onChange={(e) => setLineOld(e.target.value)} placeholder="10.00" data-testid="pricetape-line-old" />
          </FilterField>
          <FilterField label="New value" width={100}>
            <input className={FILTER_CONTROL_CLASS} value={lineNew} onChange={(e) => setLineNew(e.target.value)} placeholder="12.50" data-testid="pricetape-line-new" />
          </FilterField>
          <FilterField label="Qty on hand" width={100}>
            <input className={FILTER_CONTROL_CLASS} value={lineQty} onChange={(e) => setLineQty(e.target.value)} data-testid="pricetape-line-qty" />
          </FilterField>
          <FilterField label="Effective from" width={140}>
            <input type="date" className={FILTER_CONTROL_CLASS} value={lineEffective} onChange={(e) => setLineEffective(e.target.value)} data-testid="pricetape-line-effective" />
          </FilterField>
          <Btn size="sm" variant="secondary" onClick={addLine} data-testid="pricetape-line-add">Add line</Btn>
        </FilterBar>

        {lines.length > 0 && (
          <table className="mt-2 text-xs w-full" data-testid="pricetape-lines-draft-table">
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} data-testid={`pricetape-line-draft-${i}`}>
                  <td className="font-mono pr-3">{l.partNumber}</td>
                  <td className="font-mono pr-3">{l.oldValue} → {l.newValue}</td>
                  <td className="font-mono pr-3">qty {l.qtyOnHand}</td>
                  <td><button className="text-red-600" onClick={() => removeLine(i)} data-testid={`pricetape-line-remove-${i}`}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <Btn size="sm" className="mt-3" onClick={createLoad} disabled={busy || lines.length === 0} data-testid="pricetape-load">Load tape ({lines.length} line{lines.length === 1 ? '' : 's'})</Btn>
        <Btn size="sm" variant="secondary" className="mt-3 ml-2" onClick={load} disabled={busy} data-testid="pricetape-refresh">Refresh</Btn>
      </div>

      {error && <ErrorState testId="pricetape-error" message={error} onRetry={load} />}
      {unauthorized && <UnauthorizedState testId="pricetape-unauthorized" message={unauthorized} />}
      {mappingUnavailable && <ErrorState testId="pricetape-mapping-unavailable" message={mappingUnavailable} onRetry={() => selected && approve(selected.loadBatchId)} />}
      {busy && <LoadingState testId="pricetape-loading" label="Loading…" />}
      {!busy && tapes.length === 0 && !error && !unauthorized && <EmptyState testId="pricetape-empty" title="No price tapes loaded yet" />}

      {tapes.length > 0 && (
        <FinancialTable testId="pricetape-table">
          <ReportThead>
            <tr>
              <ReportTh>Batch</ReportTh>
              <ReportTh align="right">Preview total</ReportTh>
              <ReportTh>Direction</ReportTh>
              <ReportTh align="right">Approved total</ReportTh>
              <ReportTh>Status</ReportTh>
              <ReportTh>Actions</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {tapes.map((t) => {
              const direction = directionOf(t.previewTotal);
              return (
                <ReportTr key={t.id} testId={`pricetape-row-${t.loadBatchId}`}>
                  <ReportTd className="font-mono">{t.loadBatchId}</ReportTd>
                  <ReportTd align="right" className="font-mono tabular-nums">{t.previewTotal ?? '—'}</ReportTd>
                  <ReportTd>
                    {direction && (
                      <Badge variant={direction === 'UP' ? 'success' : 'warning'} dot data-testid={`pricetape-direction-${t.loadBatchId}`}>
                        {direction === 'UP' ? 'Upward' : 'Downward'}
                      </Badge>
                    )}
                  </ReportTd>
                  <ReportTd align="right" className="font-mono tabular-nums">{t.approvedTotal ?? '—'}</ReportTd>
                  <ReportTd><Badge variant={t.status === 'APPROVED' ? 'success' : t.status === 'REJECTED' ? 'danger' : 'warning'} dot>{t.status}</Badge></ReportTd>
                  <ReportTd>
                    <div className="flex gap-1">
                      {t.status === 'LOADED' && <Btn size="sm" variant="secondary" onClick={() => preview(t.loadBatchId)} data-testid={`pricetape-preview-${t.loadBatchId}`}>Preview</Btn>}
                      {t.status === 'PREVIEWED' && <Btn size="sm" onClick={() => approve(t.loadBatchId)} data-testid={`pricetape-approve-${t.loadBatchId}`}>Approve &amp; post</Btn>}
                    </div>
                  </ReportTd>
                </ReportTr>
              );
            })}
          </tbody>
        </FinancialTable>
      )}

      {selected && selected.previewTotal != null && (
        <div className="mt-2 text-xs" data-testid="pricetape-preview-equals-approved-proof">
          Preview Σ <span className="font-mono">{selected.previewTotal}</span>
          {selected.approvedTotal != null && (
            <> — Approved Σ <span className="font-mono">{selected.approvedTotal}</span> {String(selected.previewTotal) === String(selected.approvedTotal) ? '(exact match)' : '(MISMATCH)'}</>
          )}
        </div>
      )}
    </div>
  );
}

function ObsolescenceTab({ entityId }: { entityId: string | null }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [scraps, setScraps] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!entityId) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null);
    try {
      const [r, s] = await Promise.all([partsApi.listObsolescenceRuns(entityId), partsApi.listScrap(entityId)]);
      setRuns(r.items); setScraps(s.items);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function approveRun(id: string) {
    if (!entityId) return;
    setBusy(true); setError(null);
    try { await partsApi.approveObsolescence(id, { legalEntityId: entityId, correlationId: crypto.randomUUID(), businessDate: new Date().toISOString().slice(0, 10) }); await load(); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <FilterBar>
        <Btn size="sm" variant="secondary" onClick={load} disabled={busy} data-testid="obsolescence-refresh">Refresh</Btn>
      </FilterBar>
      {error && <ErrorState testId="obsolescence-error" message={error} onRetry={load} />}
      {busy && <LoadingState testId="obsolescence-loading" label="Loading…" />}

      <div className="mt-3">
        <div className="text-xs font-semibold text-slate-600 mb-2">Provision runs</div>
        {!busy && runs.length === 0 && <EmptyState testId="obsolescence-runs-empty" title="No obsolescence provision runs yet" />}
        {runs.length > 0 && (
          <FinancialTable testId="obsolescence-runs-table">
            <ReportThead><tr><ReportTh>As of</ReportTh><ReportTh align="right">Preview total</ReportTh><ReportTh>Status</ReportTh><ReportTh>Actions</ReportTh></tr></ReportThead>
            <tbody>
              {runs.map((r) => (
                <ReportTr key={r.id} testId={`obsolescence-run-${r.id}`}>
                  <ReportTd>{r.asOfDate?.slice(0, 10)}</ReportTd>
                  <ReportTd align="right" className="font-mono tabular-nums">{r.previewTotal}</ReportTd>
                  <ReportTd><Badge variant={r.status === 'APPROVED' ? 'success' : 'warning'} dot>{r.status}</Badge></ReportTd>
                  <ReportTd>{r.status === 'PREVIEWED' && <Btn size="sm" onClick={() => approveRun(r.id)} data-testid={`obsolescence-approve-${r.id}`}>Approve exactly as previewed</Btn>}</ReportTd>
                </ReportTr>
              ))}
            </tbody>
          </FinancialTable>
        )}
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold text-slate-600 mb-2">Scrap disposals</div>
        {!busy && scraps.length === 0 && <EmptyState testId="scrap-empty" title="No scrap disposals recorded" />}
        {scraps.length > 0 && (
          <FinancialTable testId="scrap-table">
            <ReportThead><tr><ReportTh>Part</ReportTh><ReportTh align="right">Value</ReportTh><ReportTh>Reason</ReportTh><ReportTh>Status</ReportTh></tr></ReportThead>
            <tbody>
              {scraps.map((s) => (
                <ReportTr key={s.id} testId={`scrap-row-${s.id}`}>
                  <ReportTd className="font-mono">{s.partNumber}</ReportTd>
                  <ReportTd align="right" className="font-mono tabular-nums">{s.value}</ReportTd>
                  <ReportTd>{s.reason}</ReportTd>
                  <ReportTd><Badge variant={s.status === 'POSTED' ? 'success' : 'danger'} dot>{s.status.replace(/_/g, ' ')}</Badge></ReportTd>
                </ReportTr>
              ))}
            </tbody>
          </FinancialTable>
        )}
      </div>
    </div>
  );
}

function ConfigTab({ entityId }: { entityId: string | null }) {
  const [active, setActive] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [method, setMethod] = useState<'REPLACEMENT' | 'AVERAGE'>('AVERAGE');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [approvedBy, setApprovedBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!entityId) { setError('Select a legal entity first.'); return; }
    setBusy(true); setError(null);
    try {
      const [a, h] = await Promise.all([partsApi.getActiveValuationConfig(entityId), partsApi.getValuationConfigHistory(entityId)]);
      setActive(a); setHistory(h);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function submit() {
    if (!entityId || !approvedBy.trim()) { setError('Ceremony approver is required.'); return; }
    setBusy(true); setError(null);
    try {
      await partsApi.createValuationConfig({ legalEntityId: entityId, method, effectiveFrom, ceremonyApprovedBy: approvedBy.trim() });
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <Banner kind="info" testId="valuation-config-banner" title="Prospective-only, ceremony-gated — S066 reads whichever config is active as of a movement's business date">
        Method changes never retroactively rewrite historical movement values.
      </Banner>
      <FilterBar>
        <FilterField label="Method" width={140}>
          <select className={FILTER_CONTROL_CLASS} value={method} onChange={(e) => setMethod(e.target.value as any)} data-testid="valuation-method">
            <option value="AVERAGE">Average</option>
            <option value="REPLACEMENT">Replacement</option>
          </select>
        </FilterField>
        <FilterField label="Effective from" width={140}>
          <input type="date" className={FILTER_CONTROL_CLASS} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="valuation-effective-from" />
        </FilterField>
        <FilterField label="Ceremony approver" width={160}>
          <input className={FILTER_CONTROL_CLASS} value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} data-testid="valuation-approver" />
        </FilterField>
        <Btn size="sm" onClick={submit} disabled={busy} data-testid="valuation-submit">Elect method</Btn>
        <Btn size="sm" variant="secondary" onClick={load} disabled={busy} data-testid="valuation-refresh">Refresh</Btn>
      </FilterBar>

      {error && <ErrorState testId="valuation-error" message={error} onRetry={load} />}
      {busy && <LoadingState testId="valuation-loading" label="Loading…" />}

      {active && (
        <div className="mt-3 text-xs" data-testid="valuation-active-config">
          Active method: <span className="font-semibold">{active.method}</span> (effective {active.effectiveFrom?.slice(0, 10)}, approved by {active.ceremonyApprovedBy})
        </div>
      )}
      {!busy && !active && <EmptyState testId="valuation-no-active" title="No active valuation config for this entity yet" />}

      {history.length > 0 && (
        <FinancialTable testId="valuation-history-table">
          <ReportThead><tr><ReportTh>Effective from</ReportTh><ReportTh>Method</ReportTh><ReportTh>Approved by</ReportTh></tr></ReportThead>
          <tbody>
            {history.map((h) => (
              <ReportTr key={h.id}>
                <ReportTd>{h.effectiveFrom?.slice(0, 10)}</ReportTd>
                <ReportTd>{h.method}</ReportTd>
                <ReportTd>{h.ceremonyApprovedBy}</ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}
    </div>
  );
}

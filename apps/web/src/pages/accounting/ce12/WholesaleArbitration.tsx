import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { dealAccountingApi, type WholesaleDisposition, type ArbitrationCase } from '../../../api/ce12-fni-client';
import { PageHeader, Btn, Badge } from '../../../components/ui';
import { Drawer, DrawerRow, EmptyState, ErrorState, LoadingState, UnauthorizedState, Banner } from '../../../components/report';

// CE-12 / S090 — Wholesale Disposition & Arbitration. Unit relief + wholesale
// AR (title-gated) + auction fees post as one disposition; arbitration
// claw-backs (price adjustment or unit return) are separate, reasoned
// ceremonies against an existing disposition. No dollar amount here is
// computed in the browser — every figure is a verbatim field from a real
// deal-accounting-service API response.
//
// Gap-closure pass: deal-accounting-service now exposes a real paginated
// GET /wholesale/dispositions list endpoint — the prior session-local list
// workaround (dispositions kept only in browser state because no list
// endpoint existed) has been replaced with a real query. A "look up by ID"
// panel is kept alongside it as a direct-drill-down convenience.

const fmt = (n: string | number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (!Number.isFinite(v)) return '—';
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

const fmtDateTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');

function TitleStatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'RELEASED' ? 'success' : 'warning'} dot>{status}</Badge>;
}

function NewDispositionDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { entityId, storeId } = useEntityScope();
  const [unitRef, setUnitRef] = useState('');
  const [dealNumber, setDealNumber] = useState('');
  const [titleStatus, setTitleStatus] = useState('');
  const [wholesaleAmount, setWholesaleAmount] = useState('');
  const [unitReliefAmount, setUnitReliefAmount] = useState('');
  const [auctionFeesAmount, setAuctionFeesAmount] = useState('');
  const [legalEntityId, setLegalEntityId] = useState(entityId ?? '');
  const [storeIdField, setStoreIdField] = useState(storeId ?? '');
  const [titleRefusal, setTitleRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !!unitRef.trim() && !!titleStatus.trim() && !!wholesaleAmount.trim() && !!unitReliefAmount.trim()
    && !!auctionFeesAmount.trim() && !!legalEntityId.trim() && !!storeIdField.trim();

  const mutation = useMutation({
    mutationFn: () => dealAccountingApi.disposeWholesale({
      unitRef: unitRef.trim(),
      dealNumber: dealNumber.trim() || null,
      titleStatus: titleStatus.trim(),
      wholesaleAmount: wholesaleAmount.trim(),
      unitReliefAmount: unitReliefAmount.trim(),
      auctionFeesAmount: auctionFeesAmount.trim(),
      legalEntityId: legalEntityId.trim(),
      storeId: storeIdField.trim(),
      idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (err: any) => {
      // S090 title gate — the service refuses to post the wholesale AR
      // segment unless titleStatus is explicitly RELEASED. Surface this
      // exact, named refusal rather than a generic error.
      if (err.body?.error === 'TITLE_NOT_RELEASED') setTitleRefusal(err.message);
      else setError(err.message);
    },
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title="New wholesale disposition"
      subtitle="Unit relief + wholesale AR (title-gated) + auction fees"
      testId="wholesale-new-drawer"
      actions={<>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancel</Btn>
        <Btn variant="primary" size="sm" disabled={!canSubmit} loading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="wholesale-new-submit">Post disposition</Btn>
      </>}
    >
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-600">Unit ref (VIN / stock #)
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={unitRef} onChange={(e) => setUnitRef(e.target.value)} data-testid="wholesale-unit-ref-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Deal # (optional — omit for a direct-from-inventory wholesale)
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={dealNumber} onChange={(e) => setDealNumber(e.target.value)} data-testid="wholesale-deal-number-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Title status (must be exactly &quot;RELEASED&quot; to post the AR leg)
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={titleStatus} onChange={(e) => setTitleStatus(e.target.value)} placeholder="e.g. RELEASED, PENDING, HELD" data-testid="wholesale-title-status-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Wholesale amount (AR)
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={wholesaleAmount} onChange={(e) => setWholesaleAmount(e.target.value)} placeholder="0.00" data-testid="wholesale-amount-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Unit relief amount (unit cost)
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={unitReliefAmount} onChange={(e) => setUnitReliefAmount(e.target.value)} placeholder="0.00" data-testid="wholesale-unit-relief-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Auction fees amount
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={auctionFeesAmount} onChange={(e) => setAuctionFeesAmount(e.target.value)} placeholder="0.00" data-testid="wholesale-auction-fees-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Legal entity ID
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={legalEntityId} onChange={(e) => setLegalEntityId(e.target.value)} data-testid="wholesale-legal-entity-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Store ID
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={storeIdField} onChange={(e) => setStoreIdField(e.target.value)} data-testid="wholesale-store-input" />
        </label>

        {titleRefusal && (
          <Banner kind="error" testId="wholesale-title-refusal-banner" title="Refused — title not released">
            {titleRefusal}
          </Banner>
        )}
        {error && <p className="text-xs text-red-600" data-testid="wholesale-new-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function PriceAdjustmentDrawer({ disposition, onClose, onDone }: { disposition: WholesaleDisposition; onClose: () => void; onDone: () => void }) {
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => dealAccountingApi.arbitrationPriceAdjustment(disposition.id, { adjustmentAmount: adjustmentAmount.trim(), reason: reason.trim(), idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (err: any) => setError(err.message),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Arbitration — price adjustment — ${disposition.unitRef}`}
      subtitle="Signed amount: positive increases the wholesale AR, negative decreases it"
      testId="arbitration-price-drawer"
      actions={<>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancel</Btn>
        <Btn variant="danger" size="sm" disabled={!adjustmentAmount.trim() || !reason.trim()} loading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="arbitration-price-submit">Post adjustment</Btn>
      </>}
    >
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-600">Adjustment amount (signed)
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={adjustmentAmount} onChange={(e) => setAdjustmentAmount(e.target.value)} placeholder="e.g. -250.00" data-testid="arbitration-price-amount-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Reason (required)
          <textarea className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="arbitration-price-reason-input" />
        </label>
        {error && <p className="text-xs text-red-600" data-testid="arbitration-price-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function UnitReturnDrawer({ disposition, onClose, onDone }: { disposition: WholesaleDisposition; onClose: () => void; onDone: () => void }) {
  const [conditionCostAmount, setConditionCostAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => dealAccountingApi.arbitrationUnitReturn(disposition.id, { conditionCostAmount: conditionCostAmount.trim(), reason: reason.trim(), idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (err: any) => setError(err.message),
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Arbitration — unit return — ${disposition.unitRef}`}
      subtitle="Fully reverses the original disposition journal, plus condition-cost lines"
      testId="arbitration-return-drawer"
      actions={<>
        <Btn variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>Cancel</Btn>
        <Btn variant="danger" size="sm" disabled={!conditionCostAmount.trim() || !reason.trim()} loading={mutation.isPending} onClick={() => mutation.mutate()} data-testid="arbitration-return-submit">Post unit return</Btn>
      </>}
    >
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-slate-600">Condition-cost amount
          <input className="mt-1 w-full h-8 px-2 border border-slate-200 rounded-lg text-sm font-mono" value={conditionCostAmount} onChange={(e) => setConditionCostAmount(e.target.value)} placeholder="0.00" data-testid="arbitration-return-amount-input" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Reason (required)
          <textarea className="mt-1 w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="arbitration-return-reason-input" />
        </label>
        {error && <p className="text-xs text-red-600" data-testid="arbitration-return-error">{error}</p>}
      </div>
    </Drawer>
  );
}

function DispositionDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [priceAdjustTarget, setPriceAdjustTarget] = useState<WholesaleDisposition | null>(null);
  const [unitReturnTarget, setUnitReturnTarget] = useState<WholesaleDisposition | null>(null);

  const detailQ = useQuery({
    queryKey: ['ce12-wholesale-detail', id],
    queryFn: () => dealAccountingApi.getWholesaleDisposition(id),
    retry: false,
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-wholesale-detail', id] });
  }

  const d = detailQ.data?.disposition;
  const cases = detailQ.data?.arbitrationCases ?? [];

  return (
    <>
      <Drawer open onClose={onClose} title={`Disposition — ${d?.unitRef ?? id}`} testId="wholesale-detail-drawer">
        {detailQ.isLoading && <LoadingState testId="wholesale-detail-loading" label="Loading…" />}
        {detailQ.error && (
          (detailQ.error as any).status === 401 || (detailQ.error as any).status === 403
            ? <UnauthorizedState testId="wholesale-detail-unauthorized" message={(detailQ.error as any).message} />
            : <ErrorState testId="wholesale-detail-error" message={(detailQ.error as Error).message} onRetry={() => detailQ.refetch()} />
        )}
        {d && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 mb-2">
              <TitleStatusBadge status={d.titleStatus} />
              <Badge variant={d.status === 'POSTED' ? 'success' : 'warning'} dot>{d.status}</Badge>
            </div>
            <DrawerRow label="Wholesale amount (AR)" value={fmt(d.wholesaleAmount)} />
            <DrawerRow label="Unit relief amount" value={fmt(d.unitReliefAmount)} />
            <DrawerRow label="Auction fees" value={fmt(d.auctionFeesAmount)} />
            <DrawerRow label="Outcome" value={d.dispositionOutcome} />
            <DrawerRow label="Gain/(loss)" value={fmt(d.gainLossAmount)} />
            <DrawerRow label="Created" value={fmtDateTime(d.createdAt)} />

            <div className="flex items-center gap-2 mt-4">
              <Btn size="sm" variant="secondary" onClick={() => setPriceAdjustTarget(d)} data-testid="wholesale-detail-price-adjust-btn">Arbitration — price adjustment…</Btn>
              <Btn size="sm" variant="danger" onClick={() => setUnitReturnTarget(d)} data-testid="wholesale-detail-unit-return-btn">Arbitration — unit return…</Btn>
            </div>

            <div className="text-xs font-semibold text-slate-600 mt-4">Arbitration cases</div>
            {cases.length === 0 && <div className="text-[12.5px] text-slate-400 italic">None yet.</div>}
            {cases.map((c: ArbitrationCase) => (
              <div key={c.id} className="py-2 border-b border-slate-100 text-[12.5px]" data-testid={`arbitration-case-row-${c.id}`}>
                <div className="flex justify-between">
                  <Badge variant={c.arbitrationType === 'PRICE_ADJUSTMENT' ? 'info' : 'danger'}>{c.arbitrationType}</Badge>
                  <span className="font-mono">{fmt(c.adjustmentAmount ?? c.conditionCostAmount)}</span>
                </div>
                <div className="text-slate-500 mt-0.5">{c.reason}</div>
              </div>
            ))}
          </div>
        )}
      </Drawer>
      {priceAdjustTarget && <PriceAdjustmentDrawer disposition={priceAdjustTarget} onClose={() => setPriceAdjustTarget(null)} onDone={refresh} />}
      {unitReturnTarget && <UnitReturnDrawer disposition={unitReturnTarget} onClose={() => setUnitReturnTarget(null)} onDone={refresh} />}
    </>
  );
}

export default function WholesaleArbitration() {
  const qc = useQueryClient();
  const [newOpen, setNewOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [lookupId, setLookupId] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['ce12-wholesale-dispositions', statusFilter],
    queryFn: () => dealAccountingApi.listWholesaleDispositions({ status: statusFilter || undefined }),
  });
  const dispositions = listQ.data?.items ?? [];

  async function doLookup() {
    if (!lookupId.trim()) return;
    setLookupError(null);
    try {
      const res = await dealAccountingApi.getWholesaleDisposition(lookupId.trim());
      setDetailId(res.disposition.id);
    } catch (err: any) {
      setLookupError(err.message);
    }
  }

  function refreshList() {
    qc.invalidateQueries({ queryKey: ['ce12-wholesale-dispositions'] });
  }

  return (
    <div className="p-7 min-h-full" data-testid="wholesale-arbitration-page">
      <PageHeader
        title="Wholesale &amp; Arbitration"
        subtitle="S090 — wholesale/auction disposition (unit relief + title-gated wholesale AR + auction fees) and arbitration claw-backs."
        actions={<Btn variant="primary" size="md" onClick={() => setNewOpen(true)} data-testid="wholesale-new-btn">New disposition…</Btn>}
      />

      <div className="flex items-center gap-3 my-3">
        <select className="h-8 border border-slate-200 rounded-lg px-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} data-testid="wholesale-status-filter">
          <option value="">All statuses</option>
          <option value="POSTED">Posted</option>
          <option value="ARBITRATED_ADJUSTED">Arbitrated — adjusted</option>
          <option value="ARBITRATED_RETURNED">Arbitrated — returned</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 my-4 max-w-lg">
        <h3 className="text-[13px] font-semibold text-slate-700 mb-2">Look up a disposition by ID</h3>
        <div className="flex items-center gap-2">
          <input className="h-8 flex-1 border border-slate-200 rounded-lg px-2 text-sm font-mono" value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder="Disposition ID" data-testid="wholesale-lookup-input" />
          <Btn size="sm" variant="secondary" icon={<Search size={13} />} onClick={doLookup} data-testid="wholesale-lookup-btn">Look up</Btn>
        </div>
        {lookupError && <p className="text-xs text-red-600 mt-2" data-testid="wholesale-lookup-error">{lookupError}</p>}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {listQ.isLoading && <LoadingState testId="wholesale-dispositions-loading" label="Loading dispositions…" />}
        {!listQ.isLoading && listQ.error && (
          (listQ.error as any).status === 401 || (listQ.error as any).status === 403
            ? <UnauthorizedState testId="wholesale-dispositions-unauthorized" message={(listQ.error as any).message} />
            : <ErrorState testId="wholesale-dispositions-error" message={(listQ.error as Error).message} onRetry={() => listQ.refetch()} />
        )}
        {!listQ.isLoading && !listQ.error && dispositions.length === 0 && (
          <EmptyState
            testId="wholesale-dispositions-empty"
            title="No dispositions found"
            message="Post a new wholesale disposition or look one up by ID."
            action={<Btn variant="secondary" size="sm" onClick={() => setNewOpen(true)}>New disposition…</Btn>}
          />
        )}
        {!listQ.isLoading && !listQ.error && dispositions.length > 0 && (
          <table className="w-full border-collapse" data-testid="wholesale-dispositions-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Unit ref</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Title status</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Wholesale amount</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-slate-600">Gain/(loss)</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dispositions.map((d) => (
                <tr key={d.id} data-testid={`wholesale-disposition-row-${d.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 font-mono text-[13px]">{d.unitRef}</td>
                  <td className="px-4"><TitleStatusBadge status={d.titleStatus} /></td>
                  <td className="px-4 text-right font-mono text-[13px]">{fmt(d.wholesaleAmount)}</td>
                  <td className="px-4 text-right font-mono text-[13px]">{fmt(d.gainLossAmount)}</td>
                  <td className="px-4"><Badge variant={d.status === 'POSTED' ? 'success' : 'warning'} dot>{d.status}</Badge></td>
                  <td className="px-4"><Btn variant="secondary" size="sm" onClick={() => setDetailId(d.id)} data-testid={`wholesale-view-${d.id}`}>View / arbitrate…</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {newOpen && (
        <NewDispositionDrawer
          onClose={() => setNewOpen(false)}
          onCreated={() => refreshList()}
        />
      )}
      {detailId && <DispositionDetailDrawer id={detailId} onClose={() => { setDetailId(null); refreshList(); }} />}
    </div>
  );
}

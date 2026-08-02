// CE-12 / S074-S077 — Vehicle Unit Ledger. `/accounting/vehicles/units`.
// List+detail (master-detail via in-page state, not a nested route — the
// detail panel renders inline when a unit row is clicked) showing cost
// buildup lineage + the item tie strip (unit.bookValue vs Σ cost
// components, computed server-side by getUnit() — never re-derived here),
// plus S075 demo reclass, S076 LCNRV write-down (with explicit threshold-
// refusal handling), and S077 dealer-trade ceremonies. Mirrors
// ScheduleOpenItems.tsx's tab/modal/data-testid conventions exactly.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import { vehicleAccountingApi } from '../../../api/ce12-vehicle-floorplan-client';
import { JournalDrillDrawer } from '../../../components/ce12/JournalDrillDrawer';

const fmt = (n: number | string | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const v = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(v)) return String(n);
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

const UNIT_STATUS_BADGE: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  USED: 'bg-gray-100 text-gray-700',
  DEMO: 'bg-amber-100 text-amber-700',
  WHOLESALE: 'bg-purple-100 text-purple-700',
};

const POSTING_STATUS_BADGE: Record<string, string> = {
  POSTED: 'bg-emerald-100 text-emerald-700',
  REJECTED: 'bg-red-100 text-red-700',
  REFUSED: 'bg-red-100 text-red-700',
  POSTING_FAILED: 'bg-red-100 text-red-700',
  PENDING_PREVIEW: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  REVERSED: 'bg-gray-200 text-gray-700',
  OPEN: 'bg-blue-100 text-blue-700',
  SETTLED: 'bg-gray-100 text-gray-600',
};

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {(status ?? '').replace(/_/g, ' ')}
    </span>
  );
}

function ModalShell({
  title, onClose, children, color = 'bg-brand',
}: { title: string; onClose: () => void; children: React.ReactNode; color?: string }) {
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded shadow-xl max-h-[90vh] overflow-auto">
        <div className={`flex items-center justify-between px-4 py-2 ${color} text-white rounded-t sticky top-0`}>
          <span className="text-sm font-semibold">{title}</span>
          <button onClick={onClose} data-testid="modal-close-button">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const FIELD = 'h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 focus:outline-none focus:ring-1 focus:ring-brand';

// ── Stock-In ceremony (S074 trigger) ────────────────────────────────────
function StockInModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    stockNumber: '', vin: '', entityId: '', storeId: '',
    status: 'NEW' as 'NEW' | 'USED' | 'DEMO' | 'WHOLESALE',
    acquisitionType: 'PURCHASE' as 'PURCHASE' | 'TRADE_IN' | 'DEALER_TRADE_IN' | 'FACTORY_RECEIPT',
    invoiceCost: '', transportCost: '', packCost: '', packRole: 'PACK_INCOME' as 'PACK_INCOME' | 'HOLDBACK_CLEARING', equipmentCost: '',
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      vehicleAccountingApi.stockIn({
        eventId: crypto.randomUUID(),
        stockNumber: form.stockNumber, vin: form.vin, entityId: form.entityId, storeId: form.storeId,
        status: form.status, acquisitionType: form.acquisitionType, invoiceCost: form.invoiceCost,
        transportCost: form.transportCost || undefined,
        packCost: form.packCost || undefined,
        packRole: form.packCost ? form.packRole : undefined,
        equipmentCost: form.equipmentCost || undefined,
      }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to stock in unit.'),
  });

  const required = form.stockNumber && form.vin && form.entityId && form.storeId && form.invoiceCost;

  return (
    <ModalShell title="Stock-In New Unit" onClose={onClose}>
      <div className="p-4 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs font-medium text-gray-600">Stock#</label>
            <input data-testid="stockin-stocknumber-input" className={FIELD} value={form.stockNumber} onChange={(e) => setForm((f) => ({ ...f, stockNumber: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">VIN</label>
            <input data-testid="stockin-vin-input" className={FIELD} value={form.vin} onChange={(e) => setForm((f) => ({ ...f, vin: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">Entity ID</label>
            <input data-testid="stockin-entity-input" className={FIELD} value={form.entityId} onChange={(e) => setForm((f) => ({ ...f, entityId: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">Store ID</label>
            <input data-testid="stockin-store-input" className={FIELD} value={form.storeId} onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">Status</label>
            <select data-testid="stockin-status-select" className={FIELD} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
              <option value="NEW">NEW</option><option value="USED">USED</option><option value="DEMO">DEMO</option><option value="WHOLESALE">WHOLESALE</option>
            </select></div>
          <div><label className="text-xs font-medium text-gray-600">Acquisition</label>
            <select data-testid="stockin-acquisition-select" className={FIELD} value={form.acquisitionType} onChange={(e) => setForm((f) => ({ ...f, acquisitionType: e.target.value as any }))}>
              <option value="PURCHASE">PURCHASE</option><option value="TRADE_IN">TRADE_IN</option><option value="DEALER_TRADE_IN">DEALER_TRADE_IN</option><option value="FACTORY_RECEIPT">FACTORY_RECEIPT</option>
            </select></div>
        </div>
        <div><label className="text-xs font-medium text-gray-600">Invoice/Acquisition Cost (required)</label>
          <input data-testid="stockin-invoicecost-input" className={FIELD} value={form.invoiceCost} onChange={(e) => setForm((f) => ({ ...f, invoiceCost: e.target.value }))} placeholder="0.00" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs font-medium text-gray-600">Transport Cost (optional)</label>
            <input data-testid="stockin-transport-input" className={FIELD} value={form.transportCost} onChange={(e) => setForm((f) => ({ ...f, transportCost: e.target.value }))} placeholder="0.00" /></div>
          <div><label className="text-xs font-medium text-gray-600">Equipment Cost (optional)</label>
            <input data-testid="stockin-equipment-input" className={FIELD} value={form.equipmentCost} onChange={(e) => setForm((f) => ({ ...f, equipmentCost: e.target.value }))} placeholder="0.00" /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs font-medium text-gray-600">Pack Cost (optional)</label>
            <input data-testid="stockin-pack-input" className={FIELD} value={form.packCost} onChange={(e) => setForm((f) => ({ ...f, packCost: e.target.value }))} placeholder="0.00" /></div>
          {form.packCost && (
            <div><label className="text-xs font-medium text-gray-600">Pack Role</label>
              <select data-testid="stockin-packrole-select" className={FIELD} value={form.packRole} onChange={(e) => setForm((f) => ({ ...f, packRole: e.target.value as any }))}>
                <option value="PACK_INCOME">PACK_INCOME</option><option value="HOLDBACK_CLEARING">HOLDBACK_CLEARING</option>
              </select></div>
          )}
        </div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="stockin-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!required || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Stocking in…' : 'Stock In'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Add Cost Component (transport/pack/equipment, post-stock-in) ───────
function AddCostComponentModal({ stockNumber, onClose, onDone }: { stockNumber: string; onClose: () => void; onDone: () => void }) {
  const [componentType, setComponentType] = useState<'TRANSPORT' | 'PACK' | 'EQUIPMENT'>('TRANSPORT');
  const [amount, setAmount] = useState('');
  const [packRole, setPackRole] = useState<'PACK_INCOME' | 'HOLDBACK_CLEARING'>('PACK_INCOME');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      vehicleAccountingApi.addCostComponent(stockNumber, {
        eventId: crypto.randomUUID(), componentType, amount, packRole: componentType === 'PACK' ? packRole : undefined,
      }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to add cost component.'),
  });

  return (
    <ModalShell title={`Add Cost Component — ${stockNumber}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div><label className="text-xs font-medium text-gray-600">Component Type</label>
          <select data-testid="cost-component-type-select" className={FIELD} value={componentType} onChange={(e) => setComponentType(e.target.value as any)}>
            <option value="TRANSPORT">TRANSPORT</option><option value="PACK">PACK</option><option value="EQUIPMENT">EQUIPMENT</option>
          </select></div>
        {componentType === 'PACK' && (
          <div><label className="text-xs font-medium text-gray-600">Pack Role</label>
            <select data-testid="cost-component-packrole-select" className={FIELD} value={packRole} onChange={(e) => setPackRole(e.target.value as any)}>
              <option value="PACK_INCOME">PACK_INCOME</option><option value="HOLDBACK_CLEARING">HOLDBACK_CLEARING</option>
            </select></div>
        )}
        <div><label className="text-xs font-medium text-gray-600">Amount</label>
          <input data-testid="cost-component-amount-input" className={FIELD} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="cost-component-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!amount || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Adding…' : 'Add Component'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Add Recon Cost (CE-11 boundary) ─────────────────────────────────────
function AddReconCostModal({ stockNumber, onClose, onDone }: { stockNumber: string; onClose: () => void; onDone: () => void }) {
  const [roNumber, setRoNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.addReconCost(stockNumber, { eventId: crypto.randomUUID(), roNumber, amount }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to add reconditioning cost.'),
  });

  return (
    <ModalShell title={`Add Reconditioning Cost — ${stockNumber}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div><label className="text-xs font-medium text-gray-600">RO Number</label>
          <input data-testid="recon-ro-input" className={FIELD} value={roNumber} onChange={(e) => setRoNumber(e.target.value)} /></div>
        <div><label className="text-xs font-medium text-gray-600">Amount</label>
          <input data-testid="recon-amount-input" className={FIELD} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="recon-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!roNumber || !amount || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Adding…' : 'Add Recon Cost'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── S075 Demo Reclass ceremony ──────────────────────────────────────────
function DemoReclassModal({ stockNumber, onClose, onDone }: { stockNumber: string; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.demoReclass(stockNumber, { eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to reclass unit to DEMO.'),
  });
  return (
    <ModalShell title={`Demo Reclass — ${stockNumber}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">Reclasses unit <span className="font-mono">{stockNumber}</span> from NEW to DEMO and posts the reclass journal entry. Unit value is conserved exactly.</div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="demo-reclass-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Reclassing…' : 'Reclass to DEMO'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── S077 Dealer Trade Outbound ceremony ─────────────────────────────────
function DealerTradeOutboundModal({ unit, onClose, onDone }: { unit: any; onClose: () => void; onDone: () => void }) {
  const [tradeNumber, setTradeNumber] = useState('');
  const [counterpartyDealer, setCounterpartyDealer] = useState('');
  const [agreedValue, setAgreedValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      vehicleAccountingApi.dealerTradeOutbound({
        tradeNumber, entityId: unit.entityId, storeId: unit.storeId, counterpartyDealer,
        stockNumber: unit.stockNumber, agreedValue, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to record outbound dealer trade.'),
  });

  return (
    <ModalShell title={`Dealer Trade Outbound — ${unit.stockNumber}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div><label className="text-xs font-medium text-gray-600">Trade#</label>
          <input data-testid="trade-outbound-tradenumber-input" className={FIELD} value={tradeNumber} onChange={(e) => setTradeNumber(e.target.value)} /></div>
        <div><label className="text-xs font-medium text-gray-600">Counterparty Dealer</label>
          <input data-testid="trade-outbound-counterparty-input" className={FIELD} value={counterpartyDealer} onChange={(e) => setCounterpartyDealer(e.target.value)} /></div>
        <div><label className="text-xs font-medium text-gray-600">Agreed Value</label>
          <input data-testid="trade-outbound-value-input" className={FIELD} value={agreedValue} onChange={(e) => setAgreedValue(e.target.value)} placeholder="0.00" /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="trade-outbound-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!tradeNumber || !counterpartyDealer || !agreedValue || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Recording…' : 'Record Outbound Trade'}
        </button>
      </div>
    </ModalShell>
  );
}

// ── Units tab: list + detail (master-detail via in-page state) ─────────
function UnitDetail({ stockNumber, onClose }: { stockNumber: string; onClose: () => void }) {
  const [modal, setModal] = useState<'cost' | 'recon' | 'reclass' | 'trade-out' | null>(null);
  const [drillJournal, setDrillJournal] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<any>({
    queryKey: ['ce12-unit-detail', stockNumber],
    queryFn: () => vehicleAccountingApi.getUnit(stockNumber),
  });

  function refreshAll() {
    qc.invalidateQueries({ queryKey: ['ce12-unit-detail', stockNumber] });
    qc.invalidateQueries({ queryKey: ['ce12-units'] });
  }

  if (isLoading) return <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand" /></div>;
  if (error) {
    const st = (error as any)?.status;
    return (
      <div className="p-4 text-sm text-red-700 flex items-center gap-2" data-testid="unit-detail-error">
        <AlertCircle size={16} /> {st === 403 ? 'You do not have permission to view this unit.' : (error as Error).message}
      </div>
    );
  }
  if (!data) return null;

  const unit = data.unit;
  const tieOut = data.tieOut;

  return (
    <div className="border border-gray-200 rounded bg-white mt-3" data-testid={`unit-detail-${unit.stockNumber}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
        <div className="text-sm font-semibold">Unit {unit.stockNumber} — {unit.vin}</div>
        <button className="text-xs text-gray-500 hover:underline" onClick={onClose} data-testid="unit-detail-close-button">Close</button>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap gap-4 text-xs">
          <div><span className="text-gray-500">Status:</span> <StatusBadge status={unit.status} map={UNIT_STATUS_BADGE} /></div>
          <div><span className="text-gray-500">Entity:</span> <span className="font-mono">{unit.entityId}</span></div>
          <div><span className="text-gray-500">Store:</span> <span className="font-mono">{unit.storeId}</span></div>
          <div><span className="text-gray-500">Acquisition:</span> {unit.acquisitionType}</div>
          <div><span className="text-gray-500">Book Value:</span> <span className="font-mono font-semibold">{fmt(unit.bookValue)}</span></div>
          {unit.disposedAt && <div><span className="text-gray-500">Disposed:</span> {fmtDate(unit.disposedAt)} ({unit.disposalType})</div>}
        </div>

        {/* Item tie strip — unit's schedule-item / cost-component vs GL book value reconciliation. */}
        <div
          data-testid="unit-tie-strip"
          className={`text-xs px-3 py-2 rounded font-medium ${tieOut.tiesOut ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}
        >
          {tieOut.tiesOut
            ? `Ties out — book value ${fmt(unit.bookValue)} = Σ cost components ${fmt(tieOut.componentSumCents / 100)}`
            : `TIE MISMATCH — book value ${fmt(unit.bookValue)} vs Σ cost components ${fmt(tieOut.componentSumCents / 100)}`}
        </div>

        <div>
          <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">Cost Buildup Lineage</div>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-2 py-1 font-medium">Component</th>
                <th className="text-right px-2 py-1 font-medium">Amount</th>
                <th className="text-left px-2 py-1 font-medium">Description</th>
                <th className="text-left px-2 py-1 font-medium">Journal#</th>
                <th className="text-left px-2 py-1 font-medium">Posted</th>
              </tr>
            </thead>
            <tbody>
              {(data.costComponents ?? []).length === 0 && (
                <tr><td colSpan={5} className="text-center py-4 text-gray-400">No cost components recorded.</td></tr>
              )}
              {(data.costComponents ?? []).map((c: any) => (
                <tr key={c.id} data-testid={`cost-component-row-${c.id}`} className="border-b border-gray-100">
                  <td className="px-2 py-1">{c.componentType}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmt(c.amount)}</td>
                  <td className="px-2 py-1 text-gray-600">{c.description ?? '—'}</td>
                  <td className="px-2 py-1 font-mono">
                    {c.journalNumber ? (
                      <button type="button" className="text-brand hover:underline" data-testid={`journal-drill-link-${c.id}`} onClick={() => setDrillJournal(c.journalNumber)}>{c.journalNumber}</button>
                    ) : '—'}
                  </td>
                  <td className="px-2 py-1">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          <button data-testid="unit-add-cost-component-button" className="h-7 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setModal('cost')}>Add Cost Component</button>
          <button data-testid="unit-add-recon-cost-button" className="h-7 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setModal('recon')}>Add Recon Cost</button>
          {unit.status === 'NEW' && (
            <button data-testid="unit-demo-reclass-button" className="h-7 px-2 text-[11px] border border-amber-300 text-amber-700 rounded hover:bg-amber-50" onClick={() => setModal('reclass')}>Demo Reclass</button>
          )}
          {!unit.disposedAt && (
            <button data-testid="unit-dealer-trade-outbound-button" className="h-7 px-2 text-[11px] border border-purple-300 text-purple-700 rounded hover:bg-purple-50" onClick={() => setModal('trade-out')}>Dealer Trade Outbound</button>
          )}
        </div>
      </div>

      {modal === 'cost' && <AddCostComponentModal stockNumber={unit.stockNumber} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); refetch(); }} />}
      {modal === 'recon' && <AddReconCostModal stockNumber={unit.stockNumber} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); refetch(); }} />}
      {modal === 'reclass' && <DemoReclassModal stockNumber={unit.stockNumber} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); refetch(); }} />}
      {modal === 'trade-out' && <DealerTradeOutboundModal unit={unit} onClose={() => setModal(null)} onDone={() => { setModal(null); refreshAll(); refetch(); }} />}
      {drillJournal && <JournalDrillDrawer journalNumber={drillJournal} onClose={() => setDrillJournal(null)} />}
    </div>
  );
}

function UnitsTab() {
  const [filters, setFilters] = useState({ entityId: '', storeId: '', status: '', stockNumber: '', vin: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [showStockIn, setShowStockIn] = useState(false);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-units'],
    queryFn: () => vehicleAccountingApi.listUnits(params.toString()),
  });

  const units = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <input data-testid="units-stocknumber-filter" className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={filters.stockNumber} onChange={(e) => setFilters((f) => ({ ...f, stockNumber: e.target.value }))} placeholder="Stock#" />
        <input data-testid="units-vin-filter" className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={filters.vin} onChange={(e) => setFilters((f) => ({ ...f, vin: e.target.value }))} placeholder="VIN" />
        <select data-testid="units-status-filter" className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
          value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          <option value="NEW">NEW</option><option value="USED">USED</option><option value="DEMO">DEMO</option><option value="WHOLESALE">WHOLESALE</option>
        </select>
        <input data-testid="units-entity-filter" className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={filters.entityId} onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value }))} placeholder="Entity ID" />
        <button data-testid="units-search-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Search
        </button>
        <button data-testid="units-stock-in-button" className="h-8 px-3 border border-brand text-brand text-xs rounded hover:bg-brand-light ml-auto font-medium" onClick={() => setShowStockIn(true)}>
          + Stock-In Unit
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm" data-testid="units-error-banner">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view vehicle units.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && units.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="units-empty-state">No vehicle units found. Stock in a unit to get started.</div>
        )}
        {!isLoading && !error && units.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Stock#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Acquisition</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Book Value</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Stocked</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u: any) => (
                <tr key={u.id} data-testid={`unit-row-${u.stockNumber}`} className="h-9 border-b border-gray-100 hover:bg-brand-light cursor-pointer" onClick={() => setSelected(u.stockNumber)}>
                  <td className="px-3 font-mono">{u.stockNumber}</td>
                  <td className="px-3 font-mono">{u.vin}</td>
                  <td className="px-3"><StatusBadge status={u.status} map={UNIT_STATUS_BADGE} /></td>
                  <td className="px-3">{u.acquisitionType}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(u.bookValue)}</td>
                  <td className="px-3">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selected && <UnitDetail stockNumber={selected} onClose={() => setSelected(null)} />}
      </div>

      {showStockIn && (
        <StockInModal onClose={() => setShowStockIn(false)} onDone={() => { setShowStockIn(false); qc.invalidateQueries({ queryKey: ['ce12-units'] }); refetch(); }} />
      )}
    </div>
  );
}

// ── Demo Adjustments tab (S075 preview-approve; nothing auto-posts) ────
function DemoPreviewModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [stockNumber, setStockNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.previewDemoValueAdjustment(stockNumber),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to compute preview.'),
  });
  return (
    <ModalShell title="Compute Demo Value Adjustment Preview" onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">Computes the configured-basis depreciation adjustment for a DEMO unit. Nothing posts until an accountant explicitly approves the exact computed amount below.</div>
        <div><label className="text-xs font-medium text-gray-600">Stock#</label>
          <input data-testid="demo-preview-stocknumber-input" className={FIELD} value={stockNumber} onChange={(e) => setStockNumber(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="demo-preview-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!stockNumber || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Computing…' : 'Compute Preview'}
        </button>
      </div>
    </ModalShell>
  );
}

function DemoApproveModal({ adjustment, onClose, onDone }: { adjustment: any; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.approveDemoValueAdjustment(adjustment.id, { approvedAmount: adjustment.proposedAmount.toString(), eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to approve adjustment.'),
  });
  return (
    <ModalShell title="Approve Demo Value Adjustment" onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">
          Approving posts EXACTLY the computed preview amount — <span className="font-mono font-semibold">{fmt(adjustment.proposedAmount)}</span> — for unit
          {' '}<span className="font-mono">{adjustment.unitId}</span>. This cannot be changed here; reject the preview instead if the amount is wrong.
        </div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="demo-approve-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Approving…' : 'Approve & Post'}
        </button>
      </div>
    </ModalShell>
  );
}

function DemoRejectModal({ adjustment, onClose, onDone }: { adjustment: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.rejectDemoValueAdjustment(adjustment.id, { reason }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to reject adjustment.'),
  });
  return (
    <ModalShell title="Reject Demo Value Adjustment" onClose={onClose} color="bg-red-600">
      <div className="p-4 space-y-3">
        <div><label className="text-xs font-medium text-gray-600">Reason (required)</label>
          <input data-testid="demo-reject-reason-input" className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="demo-reject-submit-button" className="h-8 px-4 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          disabled={!reason || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </ModalShell>
  );
}

function DemoReverseModal({ adjustment, onClose, onDone }: { adjustment: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.reverseDemoValueAdjustment(adjustment.id, { reason }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to reverse adjustment.'),
  });
  return (
    <ModalShell title="Reverse Posted Demo Value Adjustment" onClose={onClose} color="bg-red-600">
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">S218 symmetric reversal — posts the exact offsetting journal entry.</div>
        <div><label className="text-xs font-medium text-gray-600">Reason (required)</label>
          <input data-testid="demo-reverse-reason-input" className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="demo-reverse-submit-button" className="h-8 px-4 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          disabled={!reason || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Reversing…' : 'Reverse'}
        </button>
      </div>
    </ModalShell>
  );
}

function DemoAdjustmentsTab() {
  const [status, setStatus] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [approveTarget, setApproveTarget] = useState<any | null>(null);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [reverseTarget, setReverseTarget] = useState<any | null>(null);
  const [drillJournal, setDrillJournal] = useState<string | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (status) params.set('status', status);

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-demo-adjustments', status],
    queryFn: () => vehicleAccountingApi.listDemoValueAdjustments(params.toString()),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-demo-adjustments'] });
    refetch();
  }

  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <select data-testid="demo-adjustments-status-filter" className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING_PREVIEW">Pending Preview</option><option value="APPROVED">Approved</option><option value="POSTED">Posted</option><option value="REJECTED">Rejected</option><option value="REVERSED">Reversed</option>
        </select>
        <button data-testid="demo-adjustments-search-button" className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Search
        </button>
        <button data-testid="demo-adjustments-new-preview-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover ml-auto font-medium" onClick={() => setShowPreview(true)}>
          Compute Preview
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view demo value adjustments.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="demo-adjustments-empty-state">No demo value adjustments found.</div>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Unit ID</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Proposed</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Approved</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Journal#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a: any) => (
                <tr key={a.id} data-testid={`demo-adjustment-row-${a.id}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{a.unitId}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(a.proposedAmount)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{a.approvedAmount != null ? fmt(a.approvedAmount) : '—'}</td>
                  <td className="px-3"><StatusBadge status={a.status} map={POSTING_STATUS_BADGE} /></td>
                  <td className="px-3 font-mono">
                    {a.journalNumber ? (
                      <button type="button" className="text-brand hover:underline" data-testid={`journal-drill-link-${a.id}`} onClick={() => setDrillJournal(a.journalNumber)}>{a.journalNumber}</button>
                    ) : '—'}
                  </td>
                  <td className="px-3">
                    <div className="flex items-center gap-1">
                      {a.status === 'PENDING_PREVIEW' && (
                        <>
                          <button data-testid={`demo-approve-button-${a.id}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setApproveTarget(a)}>Approve</button>
                          <button data-testid={`demo-reject-button-${a.id}`} className="h-6 px-2 text-[11px] border border-red-300 text-red-600 rounded hover:bg-red-50" onClick={() => setRejectTarget(a)}>Reject</button>
                        </>
                      )}
                      {a.status === 'POSTED' && (
                        <button data-testid={`demo-reverse-button-${a.id}`} className="h-6 px-2 text-[11px] border border-red-300 text-red-600 rounded hover:bg-red-50" onClick={() => setReverseTarget(a)}>Reverse</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showPreview && <DemoPreviewModal onClose={() => setShowPreview(false)} onDone={() => { setShowPreview(false); refresh(); }} />}
      {approveTarget && <DemoApproveModal adjustment={approveTarget} onClose={() => setApproveTarget(null)} onDone={() => { setApproveTarget(null); refresh(); }} />}
      {rejectTarget && <DemoRejectModal adjustment={rejectTarget} onClose={() => setRejectTarget(null)} onDone={() => { setRejectTarget(null); refresh(); }} />}
      {reverseTarget && <DemoReverseModal adjustment={reverseTarget} onClose={() => setReverseTarget(null)} onDone={() => { setReverseTarget(null); refresh(); }} />}
      {drillJournal && <JournalDrillDrawer journalNumber={drillJournal} onClose={() => setDrillJournal(null)} />}
    </div>
  );
}

// ── LCNRV Worklist tab (S076) ───────────────────────────────────────────
function LcnrvEvidenceModal({ stockNumber, onClose, onDone }: { stockNumber: string; onClose: () => void; onDone: () => void }) {
  const [marketValue, setMarketValue] = useState('');
  const [source, setSource] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.addLcnrvEvidence(stockNumber, { marketValue, source, reference: reference || undefined, note: note || undefined }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to record market evidence.'),
  });

  return (
    <ModalShell title={`Enter Market Value Evidence — ${stockNumber}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">Market value is ENTERED/imported evidence — never invented by this screen.</div>
        <div><label className="text-xs font-medium text-gray-600">Market Value</label>
          <input data-testid="lcnrv-evidence-marketvalue-input" className={FIELD} value={marketValue} onChange={(e) => setMarketValue(e.target.value)} placeholder="0.00" /></div>
        <div><label className="text-xs font-medium text-gray-600">Source (required)</label>
          <input data-testid="lcnrv-evidence-source-input" className={FIELD} value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. NADA, MMR, appraisal" /></div>
        <div><label className="text-xs font-medium text-gray-600">Reference (optional)</label>
          <input data-testid="lcnrv-evidence-reference-input" className={FIELD} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        <div><label className="text-xs font-medium text-gray-600">Note (optional)</label>
          <input data-testid="lcnrv-evidence-note-input" className={FIELD} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="lcnrv-evidence-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!marketValue || !source || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Saving…' : 'Save Evidence'}
        </button>
      </div>
    </ModalShell>
  );
}

function LcnrvWriteDownModal({ row, onClose, onDone }: { row: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ writeDownAmount: string; refusalReason: string } | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      vehicleAccountingApi.lcnrvWriteDown(row.stockNumber, { evidenceId: row.latestEvidence.id, reason, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }),
    onSuccess: (result: any) => {
      if (result?.status === 'REFUSED') {
        setRefusal({ writeDownAmount: result.writeDown?.writeDownAmount, refusalReason: result.writeDown?.refusalReason });
        return;
      }
      onDone();
    },
    onError: (err: any) => {
      // S076 AC: threshold refusal is a distinguishable outcome, not a
      // generic error — the writedown endpoint returns HTTP 422 with the
      // full REFUSED result body when the amount exceeds the configured
      // threshold (see lcnrv-service.ts's writeDown()).
      if (err?.status === 422 && err?.body?.status === 'REFUSED') {
        setRefusal({ writeDownAmount: err.body.writeDown?.writeDownAmount, refusalReason: err.body.writeDown?.refusalReason });
        return;
      }
      setError(err?.message ?? 'Failed to post write-down.');
    },
  });

  return (
    <ModalShell title={`LCNRV Write-Down — ${row.stockNumber}`} onClose={onClose} color="bg-red-600">
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-500">
          Book value <span className="font-mono">{fmt(row.bookValue)}</span> vs entered market value{' '}
          <span className="font-mono">{fmt(row.latestEvidence?.marketValue)}</span> — potential write-down{' '}
          <span className="font-mono font-semibold">{fmt(row.potentialWriteDown)}</span>. Write-down is one-way (no write-up in v1).
        </div>
        <div><label className="text-xs font-medium text-gray-600">Reason (required)</label>
          <input data-testid="lcnrv-writedown-reason-input" className={FIELD} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {refusal && (
          <div data-testid="lcnrv-writedown-refused-banner" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            <div className="font-semibold">Write-down REFUSED — exceeds configured threshold</div>
            <div className="mt-0.5">Computed write-down: <span className="font-mono">{fmt(refusal.writeDownAmount)}</span></div>
            <div className="mt-0.5">{refusal.refusalReason}</div>
          </div>
        )}
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>{refusal ? 'Close' : 'Cancel'}</button>
        {!refusal && (
          <button data-testid="lcnrv-writedown-submit-button" className="h-8 px-4 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            disabled={!reason || !row.latestEvidence || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Posting…' : 'Post Write-Down'}
          </button>
        )}
      </div>
    </ModalShell>
  );
}

function LcnrvWorklistTab() {
  const [entityId, setEntityId] = useState('');
  const [status, setStatus] = useState('USED');
  const [evidenceTarget, setEvidenceTarget] = useState<string | null>(null);
  const [writeDownTarget, setWriteDownTarget] = useState<any | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (entityId) params.set('entityId', entityId);
  if (status) params.set('status', status);

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-lcnrv-worklist', entityId, status],
    queryFn: () => vehicleAccountingApi.getLcnrvWorklist(params.toString()),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-lcnrv-worklist'] });
    refetch();
  }

  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <select data-testid="lcnrv-status-filter" className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="USED">USED</option><option value="NEW">NEW</option><option value="DEMO">DEMO</option><option value="WHOLESALE">WHOLESALE</option>
        </select>
        <input data-testid="lcnrv-entity-filter" className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="Entity ID" />
        <button data-testid="lcnrv-search-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Search
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view the LCNRV worklist.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="lcnrv-empty-state">No units in this status for LCNRV review.</div>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Stock#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">VIN</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Book Value</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Market Value</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Potential Write-Down</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.unitId} data-testid={`lcnrv-worklist-row-${r.stockNumber}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{r.stockNumber}</td>
                  <td className="px-3 font-mono">{r.vin}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(r.bookValue)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{r.latestEvidence ? fmt(r.latestEvidence.marketValue) : '—'}</td>
                  <td className={`px-3 text-right font-mono tabular-nums ${r.potentialWriteDown && Number(r.potentialWriteDown) > 0 ? 'text-red-600 font-semibold' : ''}`}>
                    {r.potentialWriteDown != null ? fmt(r.potentialWriteDown) : '—'}
                  </td>
                  <td className="px-3">
                    <div className="flex items-center gap-1">
                      <button data-testid={`lcnrv-add-evidence-button-${r.stockNumber}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setEvidenceTarget(r.stockNumber)}>Add Evidence</button>
                      {r.latestEvidence && Number(r.potentialWriteDown) > 0 && (
                        <button data-testid={`lcnrv-writedown-button-${r.stockNumber}`} className="h-6 px-2 text-[11px] border border-red-300 text-red-600 rounded hover:bg-red-50" onClick={() => setWriteDownTarget(r)}>Write Down</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {evidenceTarget && <LcnrvEvidenceModal stockNumber={evidenceTarget} onClose={() => setEvidenceTarget(null)} onDone={() => { setEvidenceTarget(null); refresh(); }} />}
      {writeDownTarget && <LcnrvWriteDownModal row={writeDownTarget} onClose={() => setWriteDownTarget(null)} onDone={() => { setWriteDownTarget(null); refresh(); }} />}
    </div>
  );
}

// ── Dealer Trades tab (S077 inbound / settlement — outbound lives on the
// unit detail panel since it operates on a specific already-stocked unit) ─
function DealerTradeInboundModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ tradeNumber: '', entityId: '', storeId: '', counterpartyDealer: '', stockNumber: '', vin: '', status: 'USED' as 'NEW' | 'USED' | 'DEMO' | 'WHOLESALE', acv: '' });
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.dealerTradeInbound({ ...form, eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to record inbound dealer trade.'),
  });
  const required = form.tradeNumber && form.entityId && form.storeId && form.counterpartyDealer && form.stockNumber && form.vin && form.acv;
  return (
    <ModalShell title="Dealer Trade Inbound" onClose={onClose}>
      <div className="p-4 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="text-xs font-medium text-gray-600">Trade#</label>
            <input data-testid="trade-inbound-tradenumber-input" className={FIELD} value={form.tradeNumber} onChange={(e) => setForm((f) => ({ ...f, tradeNumber: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">Counterparty Dealer</label>
            <input data-testid="trade-inbound-counterparty-input" className={FIELD} value={form.counterpartyDealer} onChange={(e) => setForm((f) => ({ ...f, counterpartyDealer: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">Entity ID</label>
            <input data-testid="trade-inbound-entity-input" className={FIELD} value={form.entityId} onChange={(e) => setForm((f) => ({ ...f, entityId: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">Store ID</label>
            <input data-testid="trade-inbound-store-input" className={FIELD} value={form.storeId} onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">New Stock#</label>
            <input data-testid="trade-inbound-stocknumber-input" className={FIELD} value={form.stockNumber} onChange={(e) => setForm((f) => ({ ...f, stockNumber: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">VIN</label>
            <input data-testid="trade-inbound-vin-input" className={FIELD} value={form.vin} onChange={(e) => setForm((f) => ({ ...f, vin: e.target.value }))} /></div>
          <div><label className="text-xs font-medium text-gray-600">Status</label>
            <select data-testid="trade-inbound-status-select" className={FIELD} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}>
              <option value="NEW">NEW</option><option value="USED">USED</option><option value="DEMO">DEMO</option><option value="WHOLESALE">WHOLESALE</option>
            </select></div>
          <div><label className="text-xs font-medium text-gray-600">ACV</label>
            <input data-testid="trade-inbound-acv-input" className={FIELD} value={form.acv} onChange={(e) => setForm((f) => ({ ...f, acv: e.target.value }))} placeholder="0.00" /></div>
        </div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="trade-inbound-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={!required || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Recording…' : 'Record Inbound Trade'}
        </button>
      </div>
    </ModalShell>
  );
}

function DealerTradeSettleModal({ tradeNumber, onClose, onDone }: { tradeNumber: string; onClose: () => void; onDone: () => void }) {
  const [cashDifferenceNote, setCashDifferenceNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => vehicleAccountingApi.dealerTradeSettle(tradeNumber, { eventId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), cashDifferenceNote: cashDifferenceNote || undefined }),
    onSuccess: onDone,
    onError: (err: any) => setError(err?.message ?? 'Failed to settle trade.'),
  });
  return (
    <ModalShell title={`Settle Dealer Trade — ${tradeNumber}`} onClose={onClose}>
      <div className="p-4 space-y-3">
        <div className="text-xs text-gray-600">Nets the outbound receivable and inbound payable per the trade doc. A cash-difference leg (if any) is a CE-09 concept — note it here for the record.</div>
        <div><label className="text-xs font-medium text-gray-600">Cash Difference Note (optional)</label>
          <input data-testid="trade-settle-cashnote-input" className={FIELD} value={cashDifferenceNote} onChange={(e) => setCashDifferenceNote(e.target.value)} /></div>
        {error && <div className="text-xs text-red-600 flex items-center gap-1"><AlertCircle size={13} /> {error}</div>}
      </div>
      <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
        <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
        <button data-testid="trade-settle-submit-button" className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
          disabled={mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Settling…' : 'Settle Trade'}
        </button>
      </div>
    </ModalShell>
  );
}

function DealerTradesTab() {
  const [tradeNumber, setTradeNumber] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showInbound, setShowInbound] = useState(false);
  const [settleTarget, setSettleTarget] = useState<string | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (tradeNumber) params.set('tradeNumber', tradeNumber);
  if (statusFilter) params.set('status', statusFilter);

  const { data, isLoading, error, refetch } = useQuery<{ items: any[] }>({
    queryKey: ['ce12-dealer-trades', tradeNumber, statusFilter],
    queryFn: () => vehicleAccountingApi.listDealerTrades(params.toString()),
  });

  function refresh() {
    qc.invalidateQueries({ queryKey: ['ce12-dealer-trades'] });
    refetch();
  }

  const rows = data?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <input data-testid="trades-tradenumber-filter" className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
          value={tradeNumber} onChange={(e) => setTradeNumber(e.target.value)} placeholder="Trade#" />
        <select data-testid="trades-status-filter" className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option><option value="OPEN">OPEN</option><option value="SETTLED">SETTLED</option>
        </select>
        <button data-testid="trades-search-button" className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 flex items-center gap-1.5 font-medium" onClick={() => refetch()}>
          <Search size={13} /> Search
        </button>
        <button data-testid="trades-new-inbound-button" className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover ml-auto font-medium" onClick={() => setShowInbound(true)}>
          + Dealer Trade Inbound
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={24} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as any)?.status === 403 ? 'You do not have permission to view dealer trades.' : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="trades-empty-state">No dealer trades found. Outbound trades start from a unit's detail panel on the Units tab.</div>
        )}
        {!isLoading && !error && rows.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Trade#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Direction</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Counterparty</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Agreed Value</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Gain/Loss</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t: any) => (
                <tr key={t.id} data-testid={`trade-row-${t.tradeNumber}-${t.direction}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{t.tradeNumber}</td>
                  <td className="px-3">{t.direction}</td>
                  <td className="px-3">{t.counterpartyDealer}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(t.agreedValue)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{t.gainLossAmount != null ? `${t.gainLossDirection === 'LOSS' ? '-' : ''}${fmt(t.gainLossAmount)}` : '—'}</td>
                  <td className="px-3"><StatusBadge status={t.status} map={POSTING_STATUS_BADGE} /></td>
                  <td className="px-3">
                    {t.status === 'OPEN' && (
                      <button data-testid={`trade-settle-button-${t.tradeNumber}`} className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100" onClick={() => setSettleTarget(t.tradeNumber)}>Settle</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showInbound && <DealerTradeInboundModal onClose={() => setShowInbound(false)} onDone={() => { setShowInbound(false); refresh(); }} />}
      {settleTarget && <DealerTradeSettleModal tradeNumber={settleTarget} onClose={() => setSettleTarget(null)} onDone={() => { setSettleTarget(null); refresh(); }} />}
    </div>
  );
}

export default function VehicleUnitLedger() {
  const [tab, setTab] = useState<'units' | 'demo' | 'lcnrv' | 'trades'>('units');

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2">
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-sm font-semibold text-gray-900">Vehicle Unit Ledger</h1>
        </div>
        <div className="flex gap-4">
          <button data-testid="units-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'units' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('units')}>Units</button>
          <button data-testid="demo-adjustments-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'demo' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('demo')}>Demo Adjustments</button>
          <button data-testid="lcnrv-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'lcnrv' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('lcnrv')}>LCNRV Worklist</button>
          <button data-testid="dealer-trades-tab-button" className={`pb-2 text-xs font-medium border-b-2 ${tab === 'trades' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`} onClick={() => setTab('trades')}>Dealer Trades</button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'units' && <UnitsTab />}
        {tab === 'demo' && <DemoAdjustmentsTab />}
        {tab === 'lcnrv' && <LcnrvWorklistTab />}
        {tab === 'trades' && <DealerTradesTab />}
      </div>
    </div>
  );
}

/**
 * S036A/S039 — Purchase Orders (apPurchaseOrderApi).
 * Named PurchaseOrders2.tsx to avoid colliding with the existing legacy
 * PurchaseOrders.tsx which targets a different route/schema.
 */
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { apPurchaseOrderApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, Badge, PageHeader, MoneyCell, EmptyState } from '../../components/ui';

type PoStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CLOSED' | 'CANCELLED' | 'VOID' | string;

function statusVariant(s: PoStatus) {
  if (s === 'APPROVED') return 'success';
  if (s === 'VOID' || s === 'CANCELLED') return 'danger';
  if (s === 'SUBMITTED') return 'info';
  if (s === 'CLOSED') return 'neutral';
  return 'neutral'; // DRAFT
}

interface PoLine {
  lineNumber: string;
  description: string;
  qty: string;
  unitCost: string;
  glAccountId: string;
  controlNumber: string;
}

const emptyLine = (): PoLine => ({ lineNumber: '', description: '', qty: '1', unitCost: '', glAccountId: '', controlNumber: '' });

// ─── Create PO Form ─────────────────────────────────────────────────────────

function CreatePoForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [poType, setPoType] = useState<'GENERAL' | 'SUBLET' | 'VEHICLE'>('GENERAL');
  const [vendorId, setVendorId] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [department, setDepartment] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [shipTo, setShipTo] = useState('');
  const [requiredDate, setRequiredDate] = useState('');
  const [notes, setNotes] = useState('');
  const [freight, setFreight] = useState('0');
  const [tax, setTax] = useState('0');
  const [roNumber, setRoNumber] = useState('');
  const [stockNumber, setStockNumber] = useState('');
  const [lines, setLines] = useState<PoLine[]>([emptyLine()]);

  const addLine = () => setLines(l => [...l, emptyLine()]);
  const removeLine = (i: number) => setLines(l => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, k: keyof PoLine, v: string) =>
    setLines(l => l.map((line, idx) => idx === i ? { ...line, [k]: v } : line));

  const lineTotal = lines.reduce((sum, l) => sum + (parseFloat(l.qty) || 0) * (parseFloat(l.unitCost) || 0), 0);

  const mut = useMutation({
    mutationFn: () => apPurchaseOrderApi.create({
      poType, vendorId, vendorName, department, requestedBy, shipTo,
      requiredDate: requiredDate || undefined,
      notes: notes || undefined,
      freight: parseFloat(freight) || 0,
      tax: parseFloat(tax) || 0,
      ...(poType === 'SUBLET' && roNumber ? { roNumber } : {}),
      ...(poType === 'VEHICLE' && stockNumber ? { stockNumber } : {}),
      lines: lines.map(l => ({
        lineNumber: parseInt(l.lineNumber) || undefined,
        description: l.description,
        qty: parseFloat(l.qty) || 1,
        unitCost: parseFloat(l.unitCost) || 0,
        glAccountId: l.glAccountId || undefined,
        controlNumber: l.controlNumber || undefined,
      })),
    }),
    onSuccess: (po: any) => {
      qc.invalidateQueries({ queryKey: ['apar-pos'] });
      onClose();
      if (po?.id) navigate(po.id);
    },
  });

  return (
    <form onSubmit={e => { e.preventDefault(); mut.mutate(); }} className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
      <h3 className="font-semibold text-slate-800">New Purchase Order</h3>
      {mut.isError && (
        <p className="text-sm text-red-600">
          {(mut.error as any)?.status === 401 || (mut.error as any)?.status === 403
            ? 'Unauthorized.' : (mut.error as Error).message}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          PO Type
          <select required data-testid="po-type-select" className="border rounded px-2 py-1 text-sm" value={poType} onChange={e => setPoType(e.target.value as any)}>
            <option value="GENERAL">GENERAL</option>
            <option value="SUBLET">SUBLET</option>
            <option value="VEHICLE">VEHICLE</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Vendor ID <input data-testid="po-vendor-id" className="border rounded px-2 py-1 text-sm" value={vendorId} onChange={e => setVendorId(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Vendor Name <input className="border rounded px-2 py-1 text-sm" value={vendorName} onChange={e => setVendorName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Department <input className="border rounded px-2 py-1 text-sm" value={department} onChange={e => setDepartment(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Requested By <input className="border rounded px-2 py-1 text-sm" value={requestedBy} onChange={e => setRequestedBy(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Ship To <input className="border rounded px-2 py-1 text-sm" value={shipTo} onChange={e => setShipTo(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Required Date <input type="date" className="border rounded px-2 py-1 text-sm" value={requiredDate} onChange={e => setRequiredDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Freight <input type="number" step="0.01" className="border rounded px-2 py-1 text-sm" value={freight} onChange={e => setFreight(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Tax <input type="number" step="0.01" className="border rounded px-2 py-1 text-sm" value={tax} onChange={e => setTax(e.target.value)} />
        </label>
        {poType === 'SUBLET' && (
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            RO Number <input className="border rounded px-2 py-1 text-sm" value={roNumber} onChange={e => setRoNumber(e.target.value)} />
          </label>
        )}
        {poType === 'VEHICLE' && (
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Stock Number <input className="border rounded px-2 py-1 text-sm" value={stockNumber} onChange={e => setStockNumber(e.target.value)} />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-slate-600 col-span-3">
          Notes <textarea className="border rounded px-2 py-1 text-sm w-full" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </label>
      </div>

      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">Lines</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border rounded-lg overflow-hidden">
            <thead className="bg-slate-100">
              <tr>{['#','Description','Qty','Unit Cost','GL Account','Control #',''].map(h => <th key={h} className="text-left px-2 py-1.5 font-semibold text-slate-500">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((line, i) => (
                <tr key={i}>
                  <td className="px-1 py-1"><input className="border rounded w-12 px-1 py-0.5 text-xs" value={line.lineNumber} onChange={e => updateLine(i, 'lineNumber', e.target.value)} /></td>
                  <td className="px-1 py-1"><input required className="border rounded w-40 px-1 py-0.5 text-xs" placeholder="Description" value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} /></td>
                  <td className="px-1 py-1"><input required type="number" step="1" min="1" className="border rounded w-14 px-1 py-0.5 text-xs" value={line.qty} onChange={e => updateLine(i, 'qty', e.target.value)} /></td>
                  <td className="px-1 py-1"><input required type="number" step="0.01" className="border rounded w-20 px-1 py-0.5 text-xs" value={line.unitCost} onChange={e => updateLine(i, 'unitCost', e.target.value)} /></td>
                  <td className="px-1 py-1"><input className="border rounded w-36 px-1 py-0.5 text-xs" placeholder="GL Account ID" value={line.glAccountId} onChange={e => updateLine(i, 'glAccountId', e.target.value)} /></td>
                  <td className="px-1 py-1"><input className="border rounded w-24 px-1 py-0.5 text-xs" value={line.controlNumber} onChange={e => updateLine(i, 'controlNumber', e.target.value)} /></td>
                  <td className="px-1 py-1">{lines.length > 1 && <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between mt-2">
          <Btn size="sm" variant="ghost" type="button" onClick={addLine} icon={<Plus size={12} />}>Add Line</Btn>
          <span className="text-xs text-slate-500">Lines subtotal: <MoneyCell value={lineTotal} className="font-semibold" /></span>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Btn variant="secondary" size="sm" type="button" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" type="submit" loading={mut.isPending} data-testid="po-save-draft">Save Draft</Btn>
      </div>
    </form>
  );
}

// ─── Action buttons (lifecycle) ─────────────────────────────────────────────

function PoActions({ po }: { po: any }) {
  const qc = useQueryClient();
  const [cancelReason, setCancelReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const status: PoStatus = po.status ?? '';

  const mutOpts = (key: string) => ({ onSuccess: () => qc.invalidateQueries({ queryKey: ['apar-po', po.id] }), onError: (e: any) => alert(e.message) });

  const submitMut = useMutation({ mutationFn: () => apPurchaseOrderApi.submit(po.id), ...mutOpts('submit') });
  const approveMut = useMutation({ mutationFn: () => apPurchaseOrderApi.approve(po.id), ...mutOpts('approve') });
  const closeMut = useMutation({ mutationFn: () => apPurchaseOrderApi.close(po.id), ...mutOpts('close') });
  const cancelMut = useMutation({ mutationFn: () => apPurchaseOrderApi.cancel(po.id, { reason: cancelReason }), ...mutOpts('cancel') });
  const voidMut = useMutation({ mutationFn: () => apPurchaseOrderApi.void(po.id, { reason: voidReason }), ...mutOpts('void') });

  // Show actions relevant to known status; render all but let server reject invalid transitions (409/422)
  return (
    <div className="flex flex-wrap gap-2">
      {status === 'DRAFT' && (
        <Btn size="sm" onClick={() => submitMut.mutate()} loading={submitMut.isPending} data-testid="po-submit">Submit</Btn>
      )}
      {status === 'SUBMITTED' && (
        <Btn size="sm" onClick={() => approveMut.mutate()} loading={approveMut.isPending} data-testid="po-approve">Approve</Btn>
      )}
      {(status === 'APPROVED' || status === 'SUBMITTED') && (
        <Btn size="sm" variant="secondary" onClick={() => closeMut.mutate()} loading={closeMut.isPending} data-testid="po-close">Close</Btn>
      )}
      {status !== 'CANCELLED' && status !== 'VOID' && status !== 'CLOSED' && (
        <>
          <Btn size="sm" variant="secondary" onClick={() => setShowCancel(v => !v)}>Cancel</Btn>
          <Btn size="sm" variant="danger" onClick={() => setShowVoid(v => !v)}>Void</Btn>
        </>
      )}
      {showCancel && (
        <div className="w-full flex gap-2 items-center">
          <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Cancel reason" value={cancelReason} onChange={e => setCancelReason(e.target.value)} />
          <Btn size="sm" variant="secondary" onClick={() => { cancelMut.mutate(); setShowCancel(false); }} loading={cancelMut.isPending}>Confirm Cancel</Btn>
        </div>
      )}
      {showVoid && (
        <div className="w-full flex gap-2 items-center">
          <input className="border rounded px-2 py-1 text-sm flex-1" placeholder="Void reason" value={voidReason} onChange={e => setVoidReason(e.target.value)} />
          <Btn size="sm" variant="danger" onClick={() => { voidMut.mutate(); setShowVoid(false); }} loading={voidMut.isPending}>Confirm Void</Btn>
        </div>
      )}
    </div>
  );
}

// ─── PO Detail ───────────────────────────────────────────────────────────────

function PoDetail({ id }: { id: string }) {
  const { data: po, isLoading, error, refetch } = useQuery({
    queryKey: ['apar-po', id],
    queryFn: () => apPurchaseOrderApi.getById(id),
  });

  if (isLoading) return <PageLoader page="Purchase Order" service="apar-service" />;
  if (error) {
    const s = (error as any).status;
    if (s === 401 || s === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized — you do not have permission to view this purchase order.</div>;
    return <PageError error={error as Error} retry={refetch} />;
  }
  if (!po) return null;

  const lines: any[] = Array.isArray(po.lines) ? po.lines : [];
  const lineTotal = lines.reduce((sum: number, l: any) => sum + (parseFloat(l.qty) || 0) * (parseFloat(l.unitCost) || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`PO ${po.poNumber ?? id}`}
        badge={<Badge data-testid="po-status" variant={statusVariant(po.status ?? '')}>{po.status ?? '—'}</Badge>}
      />
      <div className="bg-white border rounded-xl p-6 grid grid-cols-3 gap-4 text-sm">
        <div><p className="text-xs text-slate-500">Type</p><p className="font-medium">{po.poType}</p></div>
        <div><p className="text-xs text-slate-500">Vendor</p><p className="font-medium">{po.vendorName ?? po.vendorId}</p></div>
        <div><p className="text-xs text-slate-500">Department</p><p className="font-medium">{po.department ?? '—'}</p></div>
        <div><p className="text-xs text-slate-500">Requested By</p><p className="font-medium">{po.requestedBy ?? '—'}</p></div>
        <div><p className="text-xs text-slate-500">Required Date</p><p className="font-medium">{po.requiredDate ?? '—'}</p></div>
        <div><p className="text-xs text-slate-500">Ship To</p><p className="font-medium">{po.shipTo ?? '—'}</p></div>
        {po.roNumber && <div><p className="text-xs text-slate-500">RO Number</p><p className="font-medium">{po.roNumber}</p></div>}
        {po.stockNumber && <div><p className="text-xs text-slate-500">Stock Number</p><p className="font-medium">{po.stockNumber}</p></div>}
        {po.notes && <div className="col-span-3"><p className="text-xs text-slate-500">Notes</p><p className="font-medium">{po.notes}</p></div>}
      </div>

      {lines.length > 0 && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>{['#','Description','Qty','Unit Cost','Line Total','GL Account','Control #'].map(h => <th key={h} className="text-left px-4 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l: any, i: number) => (
                <tr key={i}>
                  <td className="px-4 py-2 text-xs">{l.lineNumber ?? i + 1}</td>
                  <td className="px-4 py-2">{l.description}</td>
                  <td className="px-4 py-2">{l.qty}</td>
                  <td className="px-4 py-2"><MoneyCell value={l.unitCost} /></td>
                  <td className="px-4 py-2"><MoneyCell value={(parseFloat(l.qty) || 0) * (parseFloat(l.unitCost) || 0)} /></td>
                  <td className="px-4 py-2 font-mono text-xs">{l.glAccountId ?? '—'}</td>
                  <td className="px-4 py-2 text-xs">{l.controlNumber ?? '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-slate-50">
              <tr>
                <td colSpan={4} className="px-4 py-2 text-right text-xs text-slate-500 font-semibold">Lines subtotal</td>
                <td className="px-4 py-2"><MoneyCell value={lineTotal} className="font-semibold" /></td>
                <td colSpan={2} />
              </tr>
              {po.freight != null && (
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-xs text-slate-500">Freight</td>
                  <td className="px-4 py-2"><MoneyCell value={po.freight} /></td>
                  <td colSpan={2} />
                </tr>
              )}
              {po.tax != null && (
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-xs text-slate-500">Tax</td>
                  <td className="px-4 py-2"><MoneyCell value={po.tax} /></td>
                  <td colSpan={2} />
                </tr>
              )}
              {po.totalAmount != null && (
                <tr>
                  <td colSpan={4} className="px-4 py-2 text-right text-xs font-bold text-slate-700">Total</td>
                  <td className="px-4 py-2"><MoneyCell value={po.totalAmount} className="font-bold" /></td>
                  <td colSpan={2} />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}

      <div className="bg-white border rounded-xl p-4">
        <p className="text-xs font-semibold text-slate-600 mb-3">Actions</p>
        <PoActions po={po} />
      </div>
    </div>
  );
}

// ─── List View ───────────────────────────────────────────────────────────────

function PoList({ onSelect }: { onSelect: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const qs = statusFilter ? `status=${statusFilter}` : undefined;
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['apar-pos', qs],
    queryFn: () => apPurchaseOrderApi.list(qs),
  });

  if (isLoading) return <PageLoader page="Purchase Orders" service="apar-service" />;
  if (error) {
    const s = (error as any).status;
    if (s === 401 || s === 403) return <div className="p-8 text-red-600 font-semibold">Unauthorized.</div>;
    return <PageError error={error as Error} retry={refetch} />;
  }

  const pos: any[] = Array.isArray(data) ? data : [];

  return (
    <div>
      <PageHeader
        title="Purchase Orders"
        subtitle="S036A/S039 — AP purchase orders (new schema)"
        actions={<Btn size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(v => !v)} data-testid="po-new-open">New PO</Btn>}
      />
      {showCreate && <div className="mb-4"><CreatePoForm onClose={() => setShowCreate(false)} /></div>}
      <div className="flex gap-3 mb-4">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border rounded px-3 py-1.5 text-sm">
          <option value="">All Statuses</option>
          {['DRAFT','SUBMITTED','APPROVED','CLOSED','CANCELLED','VOID'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {pos.length === 0 ? (
        <EmptyState title="No purchase orders yet" description="Create a purchase order to get started." />
      ) : (
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-slate-50">
            <tr>{['PO #','Type','Vendor','Department','Total','Status'].map(h => <th key={h} className="text-left px-4 py-2 text-xs text-slate-500 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {pos.map((po: any) => (
              <tr key={po.id} data-testid={`po-row-${po.id}`} className="hover:bg-slate-50 cursor-pointer" onClick={() => onSelect(po.id)}>
                <td className="px-4 py-2 font-mono text-xs">{po.poNumber ?? po.id}</td>
                <td className="px-4 py-2 text-xs">{po.poType}</td>
                <td className="px-4 py-2">{po.vendorName ?? po.vendorId ?? '—'}</td>
                <td className="px-4 py-2">{po.department ?? '—'}</td>
                <td className="px-4 py-2"><MoneyCell value={po.totalAmount} /></td>
                <td className="px-4 py-2"><Badge variant={statusVariant(po.status ?? '')}>{po.status ?? '—'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Root Page ───────────────────────────────────────────────────────────────

export default function PurchaseOrders2() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  if (id) return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => navigate(-1)} className="text-xs text-brand mb-4 hover:underline">← Back to Purchase Orders</button>
      <PoDetail id={id} />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PoList onSelect={id => navigate(id)} />
    </div>
  );
}

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, AlertCircle, RefreshCw, ChevronRight, Ban, ShieldCheck, XCircle } from 'lucide-react';
import { aparApi, apInvoiceApi, purchaseOrderApi, invoiceApprovalApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import { Btn, PageHeader, Badge } from '../../components/ui';

// AMACC-CH04 S039 — Vendor Invoice Entry & 2/3-Way Match. Fable canonical
// registry record for S039 is a summary row only (EXPANSION_PENDING, no
// accepted field list/AC) — this UI implements the configurable framework
// (tenant/vendor tolerance, real PO/receipt data, no invented policy)
// described in the backend service layer.

const fmt = (n: number | string) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface InvoiceLineForm {
  mode: 'PO' | 'GL';
  poLineId: string;
  glAccountId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxAmount: string;
}

const emptyLine = (): InvoiceLineForm => ({ mode: 'GL', poLineId: '', glAccountId: '', description: '', quantity: '1', unitPrice: '', taxAmount: '0' });

function StatusBadge({ status }: { status?: string }) {
  const styles: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600',
    SUBMITTED: 'bg-blue-100 text-blue-700',
    PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700',
    VOID: 'bg-red-100 text-red-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${styles[status ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>{(status ?? '—').replace('_', ' ')}</span>;
}

function MatchStatusBadge({ status }: { status?: string }) {
  const styles: Record<string, string> = {
    NOT_RUN: 'bg-gray-100 text-gray-600',
    MATCHED: 'bg-green-100 text-green-700',
    EXCEPTION: 'bg-amber-100 text-amber-800',
    OVERRIDDEN: 'bg-purple-100 text-purple-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${styles[status ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>{(status ?? 'NOT_RUN').replace('_', ' ')}</span>;
}

export default function VendorInvoices() {
  const { id } = useParams();
  const navigate = useNavigate();
  return id ? <InvoiceDetail id={id} /> : <InvoiceList />;
}

function InvoiceList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ap-invoices-s039', statusFilter],
    queryFn: () => apInvoiceApi.list(statusFilter ? `status=${statusFilter}` : undefined),
    retry: false,
  });

  const { data: vendorData } = useQuery({
    queryKey: ['ap-vendors-for-invoice-list'],
    queryFn: () => aparApi.getVendors('status=ACTIVE&pageSize=500'),
    retry: false,
  });
  const vendors = (vendorData?.items ?? []) as any[];
  const vendorName = (vendorId: string) => vendors.find((v) => v.id === vendorId)?.vendorName ?? vendorId.slice(0, 8);

  if (isLoading) return <PageLoader page="Vendor Invoices" service="apar-service" port={3013} />;
  if (error) return <PageError error={error as Error} serviceName="AP/AR Service" port={3013} retry={refetch} />;

  const invoices = data?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Vendor Invoices (S039)" subtitle="Invoice entry with 2-way/3-way PO match against vendor bills." />

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {['', 'DRAFT', 'SUBMITTED', 'VOID'].map((s) => (
            <button
              key={s || 'ALL'}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-sm rounded ${statusFilter === s ? 'bg-brand text-white' : 'border hover:bg-gray-50'}`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <Btn variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={() => setShowNewInvoice(true)}>
          New Invoice
        </Btn>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Vendor</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Invoice #</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Inv. Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Due Date</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">Total</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Match Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Match</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">Status</th>
              <th className="px-4 py-3 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {invoices.map((inv: any) => (
              <tr key={inv.id} style={{ height: 36 }} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/accounting/ap/invoices/${inv.id}`)}>
                <td className="px-4 py-2">{vendorName(inv.vendorId)}</td>
                <td className="px-4 py-2 font-mono">{inv.invoiceNumber}</td>
                <td className="px-4 py-2">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                <td className="px-4 py-2">{new Date(inv.dueDate).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-right font-mono">${fmt(inv.totalAmount)}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{inv.matchType}</td>
                <td className="px-4 py-2"><MatchStatusBadge status={inv.matchStatus} /></td>
                <td className="px-4 py-2"><StatusBadge status={inv.status} /></td>
                <td className="px-4 py-2"><ChevronRight className="w-4 h-4 text-gray-300" /></td>
              </tr>
            ))}
            {invoices.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">No vendor invoices yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showNewInvoice && (
        <NewInvoiceDialog
          vendors={vendors}
          onClose={() => setShowNewInvoice(false)}
          onCreated={(invId) => { setShowNewInvoice(false); queryClient.invalidateQueries({ queryKey: ['ap-invoices-s039'] }); navigate(`/accounting/ap/invoices/${invId}`); }}
        />
      )}
    </div>
  );
}

function NewInvoiceDialog({ vendors, onClose, onCreated }: { vendors: any[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [vendorId, setVendorId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const [poId, setPoId] = useState('');
  const [freightAmount, setFreightAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<InvoiceLineForm[]>([emptyLine()]);
  const [duplicateWarning, setDuplicateWarning] = useState<any[] | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data: pos } = useQuery({
    queryKey: ['pos-for-vendor', vendorId],
    queryFn: () => purchaseOrderApi.list(`vendorId=${vendorId}`).catch(() => []),
    enabled: !!vendorId,
  });
  const selectedPO = (pos ?? []).find((p: any) => p.id === poId);

  const createMut = useMutation({
    mutationFn: (data: any) => apInvoiceApi.create(data),
    onSuccess: (invoice: any) => onCreated(invoice.id),
    onError: (err: any) => {
      if (err?.status === 409 && err?.body?.error === 'DUPLICATE_INVOICE_ACKNOWLEDGEMENT_REQUIRED') {
        setDuplicateWarning(err.body.candidates ?? []);
        return;
      }
      setFormError(err?.body?.message ?? err.message ?? 'Failed to create invoice');
    },
  });

  function buildPayload(override?: { reason: string }) {
    return {
      vendorId,
      invoiceNumber,
      invoiceDate,
      dueDate,
      poId: poId || undefined,
      freightAmount: parseFloat(freightAmount) || 0,
      notes: notes || undefined,
      lines: lines.map((l) => ({
        poLineId: l.mode === 'PO' ? l.poLineId : undefined,
        glAccountId: l.mode === 'GL' ? l.glAccountId : undefined,
        description: l.description,
        quantity: parseFloat(l.quantity) || 1,
        unitPrice: parseFloat(l.unitPrice) || 0,
        taxAmount: parseFloat(l.taxAmount) || 0,
      })),
      ...(override ? { override } : {}),
    };
  }

  function handleSubmit() {
    setFormError(null);
    if (!vendorId || !invoiceNumber.trim()) { setFormError('Vendor and Invoice # are required'); return; }
    if (lines.some((l) => (l.mode === 'PO' && !l.poLineId) || (l.mode === 'GL' && !l.glAccountId) || !l.description || !l.unitPrice)) {
      setFormError('Every line needs a description, unit price, and either a PO line or a GL account');
      return;
    }
    createMut.mutate(buildPayload());
  }

  const total = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 1) * (parseFloat(l.unitPrice) || 0) + (parseFloat(l.taxAmount) || 0), 0) + (parseFloat(freightAmount) || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <h3 className="font-bold text-lg">New Vendor Invoice</h3>

        {formError && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{formError}</div>}

        {duplicateWarning && (
          <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm space-y-2">
            <p className="font-medium text-amber-800">A potential duplicate invoice already exists for this vendor:</p>
            <ul className="list-disc pl-5 text-amber-700">
              {duplicateWarning.map((c) => (<li key={c.invoiceId}>{c.invoiceNumber} — {c.status} — ${fmt(c.totalAmount)}</li>))}
            </ul>
            <div className="flex gap-2 items-center">
              <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Reason to proceed anyway..." className="flex-1 border rounded px-2 py-1.5 text-sm" />
              <button
                disabled={!overrideReason.trim() || createMut.isPending}
                onClick={() => createMut.mutate(buildPayload({ reason: overrideReason }))}
                className="px-3 py-1.5 bg-amber-600 text-white rounded text-sm disabled:opacity-40"
              >
                Confirm Anyway
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
            <select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setPoId(''); }} className="w-full border rounded px-3 py-2 text-sm">
              <option value="">Select vendor...</option>
              {vendors.map((v) => (<option key={v.id} value={v.id}>{v.vendorNumber} — {v.vendorName}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice #</label>
            <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="INV-1001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Purchase Order (optional)</label>
            <select value={poId} onChange={(e) => setPoId(e.target.value)} disabled={!vendorId} className="w-full border rounded px-3 py-2 text-sm">
              <option value="">No PO — direct GL coding</option>
              {(pos ?? []).map((p: any) => (<option key={p.id} value={p.id}>{p.poNumber ?? '(draft)'} — ${fmt(p.total)}</option>))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
            <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Freight</label>
            <input type="number" step="0.01" value={freightAmount} onChange={(e) => setFreightAmount(e.target.value)} className="w-full border rounded px-3 py-2 text-sm text-right font-mono" />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-sm">Invoice Lines</h4>
            <button onClick={() => setLines([...lines, emptyLine()])} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200">+ Add Line</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="pb-2">Coding</th>
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right w-20">Qty</th>
                <th className="pb-2 text-right w-24">Unit Price</th>
                <th className="pb-2 text-right w-20">Tax</th>
                <th className="pb-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b border-gray-50">
                  <td className="py-2 pr-2">
                    {poId ? (
                      <select
                        value={line.mode === 'PO' ? line.poLineId : ''}
                        onChange={(e) => {
                          const poLine = selectedPO?.lines?.find((l: any) => l.id === e.target.value);
                          setLines(lines.map((l, idx) => idx === i ? {
                            ...l, mode: e.target.value ? 'PO' : 'GL', poLineId: e.target.value,
                            description: poLine?.description ?? l.description,
                            unitPrice: poLine ? String(poLine.unitCost) : l.unitPrice,
                          } : l));
                        }}
                        className="w-full border rounded px-2 py-1.5 text-sm"
                      >
                        <option value="">GL account (non-PO)</option>
                        {(selectedPO?.lines ?? []).map((pl: any) => (<option key={pl.id} value={pl.id}>Line {pl.lineNumber}: {pl.description}</option>))}
                      </select>
                    ) : (
                      <input
                        value={line.glAccountId}
                        onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, mode: 'GL', glAccountId: e.target.value } : l))}
                        placeholder="GL Account ID"
                        className="w-full border rounded px-2 py-1.5 text-sm font-mono"
                      />
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <input value={line.description} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, description: e.target.value } : l))} className="w-full border rounded px-2 py-1.5 text-sm" placeholder="Description" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" step="0.01" value={line.quantity} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, quantity: e.target.value } : l))} className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" step="0.01" value={line.unitPrice} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, unitPrice: e.target.value } : l))} className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono" />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="number" step="0.01" value={line.taxAmount} onChange={(e) => setLines(lines.map((l, idx) => idx === i ? { ...l, taxAmount: e.target.value } : l))} className="w-full border rounded px-2 py-1.5 text-sm text-right font-mono" />
                  </td>
                  <td className="py-2">
                    {lines.length > 1 && <button onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600 text-xs">✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-300 font-bold bg-gray-50">
                <td colSpan={4} className="py-3 text-right pr-4">Total (incl. freight):</td>
                <td colSpan={2} className="py-3 text-right font-mono pr-2">${fmt(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" placeholder="Optional note..." />
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={handleSubmit} disabled={createMut.isPending} className="px-6 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand disabled:opacity-40">
            {createMut.isPending ? 'Saving...' : 'Save Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InvoiceDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [overrideReason, setOverrideReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: invoice, isLoading, error, refetch } = useQuery({
    queryKey: ['ap-invoice-s039', id],
    queryFn: () => apInvoiceApi.getById(id),
    retry: false,
  });

  const matchMut = useMutation({
    mutationFn: () => apInvoiceApi.runMatch(id),
    onSuccess: () => { setActionError(null); refetch(); },
    onError: (err: any) => setActionError(err?.body?.message ?? err.message),
  });

  const submitMut = useMutation({
    mutationFn: (data: any) => apInvoiceApi.submit(id, data),
    onSuccess: () => { setActionError(null); refetch(); },
    onError: (err: any) => setActionError(err?.body?.message ?? err.message),
  });

  const voidMut = useMutation({
    mutationFn: (data: any) => apInvoiceApi.void(id, data),
    onSuccess: () => { setShowVoid(false); refetch(); },
    onError: (err: any) => setActionError(err?.body?.message ?? err.message),
  });

  if (isLoading) return <PageLoader page="Vendor Invoice" service="apar-service" port={3013} />;
  if (error) return <PageError error={error as Error} serviceName="AP/AR Service" port={3013} retry={refetch} />;
  if (!invoice) return null;

  const latestMatch = (invoice.matchResults ?? [])[0];
  const hasException = invoice.matchStatus === 'EXCEPTION';

  return (
    <div className="p-6 space-y-4">
      <button onClick={() => navigate('/accounting/ap/invoices')} className="text-sm text-brand hover:underline">← Back to Invoices</button>

      <PageHeader title={`Invoice ${invoice.invoiceNumber}`} subtitle={`Status: ${invoice.status} · Match: ${invoice.matchStatus} (${invoice.matchType})`} />

      {actionError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center gap-2"><AlertCircle className="w-4 h-4" />{actionError}</div>}

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-600">Total</p><p className="text-2xl font-bold font-mono">${fmt(invoice.totalAmount)}</p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-600">Status</p><p className="mt-1"><StatusBadge status={invoice.status} /></p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-600">Match Status</p><p className="mt-1"><MatchStatusBadge status={invoice.matchStatus} /></p></div>
        <div className="bg-white rounded-lg shadow p-4"><p className="text-sm text-gray-600">Match Type</p><p className="text-lg font-semibold">{invoice.matchType}</p></div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">#</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Description</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase">Coding</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Qty</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Unit Price</th>
              <th className="px-4 py-2 text-right text-xs font-semibold text-gray-600 uppercase">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(invoice.lines ?? []).map((l: any) => (
              <tr key={l.id}>
                <td className="px-4 py-2">{l.lineNumber}</td>
                <td className="px-4 py-2">{l.description}</td>
                <td className="px-4 py-2 text-xs font-mono text-gray-500">{l.poLineId ? `PO Line ${l.poLineId.slice(0, 8)}` : `GL ${l.glAccountId?.slice(0, 8)}`}</td>
                <td className="px-4 py-2 text-right font-mono">{fmt(l.quantity)}</td>
                <td className="px-4 py-2 text-right font-mono">${fmt(l.unitPrice)}</td>
                <td className="px-4 py-2 text-right font-mono">${fmt(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {latestMatch && (
        <div className="bg-white rounded-lg shadow p-4 space-y-2">
          <h4 className="font-semibold text-sm">Latest Match Result — {new Date(latestMatch.matchedAt).toLocaleString()}</h4>
          {(latestMatch.variances ?? []).length === 0 ? (
            <p className="text-sm text-green-700">No variances — exact match.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-600 border-b"><th className="pb-2">Type</th><th className="pb-2 text-right">Expected</th><th className="pb-2 text-right">Actual</th><th className="pb-2 text-right">Variance</th><th className="pb-2">Within Tolerance?</th></tr></thead>
              <tbody>
                {latestMatch.variances.map((v: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="py-2">{v.type}</td>
                    <td className="py-2 text-right font-mono">{fmt(v.expected)}</td>
                    <td className="py-2 text-right font-mono">{fmt(v.actual)}</td>
                    <td className="py-2 text-right font-mono">{fmt(v.varianceAmount)}</td>
                    <td className="py-2">{v.withinTolerance ? <Badge variant="success">Yes</Badge> : <Badge variant="danger">No</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {invoice.status === 'DRAFT' && (
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <h4 className="font-semibold text-sm">Actions</h4>
          <div className="flex gap-2">
            <Btn variant="secondary" size="md" icon={<RefreshCw className="w-4 h-4" />} onClick={() => matchMut.mutate()}>
              {matchMut.isPending ? 'Running Match...' : 'Run Match'}
            </Btn>
            {!hasException && (
              <Btn variant="primary" size="md" icon={<Check className="w-4 h-4" />} onClick={() => submitMut.mutate({ version: invoice.version })}>
                {submitMut.isPending ? 'Submitting...' : 'Submit for Approval'}
              </Btn>
            )}
            <button onClick={() => setShowVoid(true)} className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
              <Ban className="w-4 h-4" /> Void
            </button>
          </div>

          {hasException && (
            <div className="bg-amber-50 border border-amber-300 rounded p-3 text-sm space-y-2">
              <p className="text-amber-800 font-medium">This invoice has unresolved match exceptions. Submitting requires an override reason (and match-override permission).</p>
              <div className="flex gap-2 items-center">
                <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Override reason..." className="flex-1 border rounded px-2 py-1.5 text-sm" />
                <button
                  disabled={!overrideReason.trim() || submitMut.isPending}
                  onClick={() => submitMut.mutate({ version: invoice.version, override: { reason: overrideReason } })}
                  className="px-3 py-1.5 bg-amber-600 text-white rounded text-sm disabled:opacity-40"
                >
                  Submit Anyway
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {['SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(invoice.status) && (
        <ApprovalPanel invoice={invoice} onChange={refetch} />
      )}

      {showVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] p-6 space-y-4">
            <h3 className="font-bold text-lg text-red-700 flex items-center gap-2"><Ban className="w-5 h-5" />Void Invoice {invoice.invoiceNumber}?</h3>
            <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason for voiding..." className="w-full border rounded px-3 py-2 text-sm" autoFocus />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowVoid(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => voidMut.mutate({ version: invoice.version, reason: voidReason })}
                disabled={!voidReason.trim() || voidMut.isPending}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {voidMut.isPending ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// AMACC-CH04 S041 — Invoice Approval Matrix panel, shown once an invoice
// reaches SUBMITTED. Reads the approval instance (only exists once
// /approval/start has been called) and drives the sequential tier
// approve/reject workflow against the tenant-configured matrix.
function ApprovalPanel({ invoice, onChange }: { invoice: any; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  const { data: instance, refetch: refetchInstance, isLoading } = useQuery({
    queryKey: ['ap-invoice-approval', invoice.id],
    queryFn: () => invoiceApprovalApi.getInstance(invoice.id),
    retry: false,
    enabled: invoice.status !== 'SUBMITTED',
  });

  const startMut = useMutation({
    mutationFn: () => invoiceApprovalApi.start(invoice.id),
    onSuccess: () => { setError(null); onChange(); refetchInstance(); },
    onError: (err: any) => setError(err?.body?.message ?? err.message),
  });

  const approveMut = useMutation({
    mutationFn: () => invoiceApprovalApi.approve(invoice.id, { version: invoice.version }),
    onSuccess: () => { setError(null); onChange(); refetchInstance(); },
    onError: (err: any) => setError(err?.body?.message ?? err.message),
  });

  const rejectMut = useMutation({
    mutationFn: () => invoiceApprovalApi.reject(invoice.id, { version: invoice.version, reason: rejectReason }),
    onSuccess: () => { setShowReject(false); setRejectReason(''); onChange(); refetchInstance(); },
    onError: (err: any) => setError(err?.body?.message ?? err.message),
  });

  const retryGlMut = useMutation({
    mutationFn: () => invoiceApprovalApi.retryGlPosting(invoice.id),
    onSuccess: () => { setError(null); onChange(); },
    onError: (err: any) => setError(err?.body?.message ?? err.message),
  });

  const pendingStep = (instance?.steps ?? []).filter((s: any) => s.status === 'PENDING').sort((a: any, b: any) => a.sequence - b.sequence)[0];

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-3">
      <h4 className="font-semibold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-brand" /> Approval Matrix (S041)</h4>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">{error}</div>}

      {invoice.status === 'SUBMITTED' && (
        <Btn variant="primary" size="md" onClick={() => startMut.mutate()}>
          {startMut.isPending ? 'Starting...' : 'Start Approval'}
        </Btn>
      )}

      {invoice.status !== 'SUBMITTED' && isLoading && <p className="text-sm text-gray-400">Loading approval instance...</p>}

      {instance && (
        <div className="space-y-2">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-600 border-b"><th className="pb-2">Tier</th><th className="pb-2">Required Role</th><th className="pb-2">Status</th><th className="pb-2">Decided By</th></tr></thead>
            <tbody>
              {(instance.steps ?? []).map((s: any) => (
                <tr key={s.id} className="border-b border-gray-50">
                  <td className="py-2">{s.sequence}</td>
                  <td className="py-2 font-mono text-xs">{s.requiredRole}</td>
                  <td className="py-2"><Badge variant={s.status === 'APPROVED' ? 'success' : s.status === 'REJECTED' ? 'danger' : s.status === 'SKIPPED' ? 'neutral' : 'warning'}>{s.status}</Badge></td>
                  <td className="py-2 text-xs text-gray-500">{s.decidedBy ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {pendingStep && invoice.status === 'PENDING_APPROVAL' && (
            <div className="flex gap-2">
              <Btn variant="primary" size="md" icon={<Check className="w-4 h-4" />} onClick={() => approveMut.mutate()}>
                {approveMut.isPending ? 'Approving...' : `Approve (tier ${pendingStep.sequence})`}
              </Btn>
              <button onClick={() => setShowReject(true)} className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50">
                <XCircle className="w-4 h-4" /> Reject
              </button>
            </div>
          )}

          {invoice.status === 'APPROVED' && (
            <div className="text-sm">
              {invoice.approvalGlEntryId ? (
                <p className="text-green-700">AP liability GL entry posted: <span className="font-mono">{invoice.approvalGlEntryId}</span></p>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-amber-700">GL liability posting has not completed yet.</p>
                  <button onClick={() => retryGlMut.mutate()} className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded hover:bg-amber-200">
                    {retryGlMut.isPending ? 'Retrying...' : 'Retry GL Posting'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showReject && (
        <div className="bg-red-50 border border-red-300 rounded p-3 text-sm space-y-2">
          <input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Reason for rejecting..." className="w-full border rounded px-2 py-1.5 text-sm" autoFocus />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowReject(false)} className="px-3 py-1.5 border rounded text-sm">Cancel</button>
            <button disabled={!rejectReason.trim() || rejectMut.isPending} onClick={() => rejectMut.mutate()} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm disabled:opacity-40">
              {rejectMut.isPending ? 'Rejecting...' : 'Confirm Reject'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

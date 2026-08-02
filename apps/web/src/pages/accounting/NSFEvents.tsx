/**
 * AMACC S045 — NSF Events
 * List, detail, and create form for NSF (Non-Sufficient Funds) events.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, AlertCircle } from 'lucide-react';
import { nsfEventApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import {
  Btn, Badge, PageHeader, MoneyCell, EmptyState,
} from '../../components/ui';
import DataTable, { Column } from '../../components/DataTable';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NSFEvent {
  id: string;
  customerId: string;
  originalArEntryId: string;
  amount: number | string;
  reason: string;
  source?: 'MANUAL' | 'BANK_FEED_NOT_CONFIGURED';
  status?: string;
  createdAt?: string;
}

function emptyForm() {
  return {
    customerId: '',
    originalArEntryId: '',
    amount: '',
    reason: '',
    source: '' as '' | 'MANUAL' | 'BANK_FEED_NOT_CONFIGURED',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NSFEvents() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: events,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<NSFEvent[]>({
    queryKey: ['nsf-events-list'],
    queryFn: () => nsfEventApi.list(),
    retry: false,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErrorObj } = useQuery<NSFEvent>({
    queryKey: ['nsf-event', selectedId],
    queryFn: () => nsfEventApi.getById(selectedId!),
    enabled: !!selectedId,
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: () =>
      nsfEventApi.create({
        customerId: form.customerId,
        originalArEntryId: form.originalArEntryId,
        amount: parseFloat(form.amount),
        reason: form.reason,
        source: form.source || undefined,
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['nsf-events-list'] });
      setShowCreate(false);
      setForm(emptyForm());
      setFormError(null);
      setSelectedId(res.id);
    },
    onError: (err: any) => setFormError(err?.body?.message || err.message || 'Create failed'),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amt = parseFloat(form.amount);
    if (!form.customerId.trim() || !form.originalArEntryId.trim() || isNaN(amt) || amt <= 0 || !form.reason.trim()) {
      setFormError('All required fields must be filled with valid values.');
      return;
    }
    createMut.mutate();
  }

  const isUnauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;

  const columns: Column<NSFEvent>[] = [
    { key: 'customerId', label: 'Customer ID', mono: true },
    { key: 'originalArEntryId', label: 'AR Entry', mono: true },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <MoneyCell value={r.amount} /> },
    { key: 'reason', label: 'Reason', render: (r) => <span className="truncate max-w-[200px] block">{r.reason}</span> },
    {
      key: 'source',
      label: 'Source',
      render: (r) => r.source ? (
        <Badge variant={r.source === 'BANK_FEED_NOT_CONFIGURED' ? 'warning' : 'neutral'}>{r.source}</Badge>
      ) : <span className="text-slate-400">—</span>,
    },
    { key: 'createdAt', label: 'Date', render: (r) => r.createdAt?.slice(0, 10) ?? '—' },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="NSF Events"
        subtitle="Non-sufficient funds events — returned payments and bank rejections"
        actions={
          <Btn icon={<Plus size={14} />} onClick={() => { setShowCreate(true); setSelectedId(null); }} data-testid="nsf-new-open">
            New NSF Event
          </Btn>
        }
      />

      {isUnauthorized && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          You do not have permission to view NSF events.
        </div>
      )}

      {isLoading && <PageLoader page="NSF Events" service="apar-service" />}
      {isError && !isUnauthorized && <PageError error={error as Error} retry={refetch} />}

      {!isLoading && !isError && (
        events && events.length > 0 ? (
          <DataTable
            columns={columns}
            data={events}
            rowTestIdPrefix="nsf-row"
            onRowClick={(r) => { setSelectedId(r.id); setShowCreate(false); }}
          />
        ) : (
          <EmptyState
            icon={<AlertCircle size={20} />}
            title="No NSF events recorded"
            description="Create an NSF event when a payment is returned due to insufficient funds."
            action={<Btn size="sm" onClick={() => setShowCreate(true)}>New NSF Event</Btn>}
          />
        )
      )}

      {/* Create form */}
      {showCreate && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-base font-bold text-slate-900">New NSF Event</h2>
            <button onClick={() => { setShowCreate(false); setFormError(null); setForm(emptyForm()); }} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {formError && <div data-testid="nsf-create-error" className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{formError}</div>}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Customer ID <span className="text-red-500">*</span></label>
              <input data-testid="nsf-customer-id" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="cust-uuid" value={form.customerId} onChange={e => setForm(p => ({ ...p, customerId: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Original AR Entry ID <span className="text-red-500">*</span></label>
              <input data-testid="nsf-ar-entry-id" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="ar-entry-uuid" value={form.originalArEntryId} onChange={e => setForm(p => ({ ...p, originalArEntryId: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Amount <span className="text-red-500">*</span></label>
              <input data-testid="nsf-amount" type="number" step="0.01" min="0.01" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="0.00" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reason <span className="text-red-500">*</span></label>
              <input data-testid="nsf-reason" className="w-full border rounded px-3 py-2 text-sm" placeholder="Returned check — insufficient funds" value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
              <select
                data-testid="nsf-source"
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.source}
                onChange={e => setForm(p => ({ ...p, source: e.target.value as any }))}
              >
                <option value="">— Select source (optional) —</option>
                <option value="MANUAL">MANUAL</option>
                <option value="BANK_FEED_NOT_CONFIGURED">BANK_FEED_NOT_CONFIGURED</option>
              </select>
            </div>
            <div className="flex gap-3 pt-2">
              <Btn type="submit" loading={createMut.isPending} data-testid="nsf-create-submit">Create NSF Event</Btn>
              <Btn variant="secondary" type="button" onClick={() => { setShowCreate(false); setFormError(null); setForm(emptyForm()); }}>Cancel</Btn>
            </div>
          </form>
        </div>
      )}

      {/* Detail panel */}
      {selectedId && !showCreate && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-base font-bold text-slate-900">NSF Event Detail</h2>
            <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {detailLoading && <PageLoader page="NSF event detail" />}
            {detailError && <PageError error={detailErrorObj as Error} />}
            {detail && !detailLoading && (
              <dl className="space-y-3 text-sm">
                <div><dt className="text-xs font-medium text-slate-500">Customer ID</dt><dd className="font-mono">{detail.customerId}</dd></div>
                <div><dt className="text-xs font-medium text-slate-500">Original AR Entry</dt><dd className="font-mono">{detail.originalArEntryId}</dd></div>
                <div><dt className="text-xs font-medium text-slate-500">Amount</dt><dd className="font-mono font-bold text-lg"><MoneyCell value={detail.amount} /></dd></div>
                <div><dt className="text-xs font-medium text-slate-500">Reason</dt><dd className="text-slate-700">{detail.reason}</dd></div>
                {detail.source && <div><dt className="text-xs font-medium text-slate-500">Source</dt><dd><Badge variant={detail.source === 'BANK_FEED_NOT_CONFIGURED' ? 'warning' : 'neutral'}>{detail.source}</Badge></dd></div>}
                {detail.status && <div><dt className="text-xs font-medium text-slate-500">Status</dt><dd><Badge data-testid="nsf-detail-status" variant={detail.status === 'RESOLVED' ? 'success' : 'neutral'}>{detail.status}</Badge></dd></div>}
                {detail.createdAt && <div><dt className="text-xs font-medium text-slate-500">Created</dt><dd className="text-slate-500">{new Date(detail.createdAt).toLocaleString()}</dd></div>}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

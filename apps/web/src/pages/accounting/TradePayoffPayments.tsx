/**
 * AMACC S048 — Trade Payoff Payments
 * List + create form + detail view for trade payoff payment records.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, FileText } from 'lucide-react';
import { tradePayoffApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import {
  Btn, Badge, PageHeader, MoneyCell, EmptyState, LoadingTable,
} from '../../components/ui';
import DataTable, { Column } from '../../components/DataTable';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradePayoff {
  id: string;
  dealReference: string;
  payeeName: string;
  payeeRemitAddress: string;
  payeeReference?: string;
  amount: number | string;
  goodThroughDate: string;
  status?: string;
  createdAt?: string;
}

function emptyForm() {
  return {
    dealReference: '',
    payeeName: '',
    payeeRemitAddress: '',
    payeeReference: '',
    amount: '',
    goodThroughDate: '',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TradePayoffPayments() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: items,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<TradePayoff[]>({
    queryKey: ['trade-payoff-list'],
    queryFn: () => tradePayoffApi.list(),
    retry: false,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErrorObj } = useQuery<TradePayoff>({
    queryKey: ['trade-payoff', selectedId],
    queryFn: () => tradePayoffApi.getById(selectedId!),
    enabled: !!selectedId,
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: () =>
      tradePayoffApi.create({
        dealReference: form.dealReference,
        payeeName: form.payeeName,
        payeeRemitAddress: form.payeeRemitAddress,
        payeeReference: form.payeeReference || undefined,
        amount: parseFloat(form.amount),
        goodThroughDate: form.goodThroughDate,
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['trade-payoff-list'] });
      setShowCreate(false);
      setForm(emptyForm());
      setSelectedId(res.id);
    },
    onError: (err: any) => {
      setFormError(err?.body?.message || err.message || 'Create failed');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.dealReference.trim() || !form.payeeName.trim() || !form.payeeRemitAddress.trim() || !form.amount || !form.goodThroughDate) {
      setFormError('All required fields must be filled.');
      return;
    }
    const amt = parseFloat(form.amount);
    if (isNaN(amt) || amt <= 0) {
      setFormError('Amount must be a positive number.');
      return;
    }
    createMut.mutate();
  }

  const isUnauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;

  const columns: Column<TradePayoff>[] = [
    { key: 'dealReference', label: 'Deal Ref', width: '140px' },
    { key: 'payeeName', label: 'Payee' },
    { key: 'payeeReference', label: 'Payee Ref', render: (r) => r.payeeReference || '—' },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (r) => <MoneyCell value={r.amount} />,
    },
    { key: 'goodThroughDate', label: 'Good Through', render: (r) => r.goodThroughDate?.slice(0, 10) ?? '—' },
    {
      key: 'status',
      label: 'Status',
      render: (r) => r.status ? (
        <Badge variant={r.status === 'PAID' ? 'success' : r.status === 'CANCELLED' ? 'danger' : 'info'}>
          {r.status}
        </Badge>
      ) : <Badge variant="neutral">—</Badge>,
    },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Trade Payoff Payments"
        subtitle="Manage trade-in payoff disbursements to lienholders"
        actions={
          <Btn icon={<Plus size={14} />} onClick={() => { setShowCreate(true); setSelectedId(null); }} data-testid="tradepayoff-new-open">
            New Payoff
          </Btn>
        }
      />

      {/* Unauthorized */}
      {isUnauthorized && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          You do not have permission to view trade payoff payments.
        </div>
      )}

      {/* Loading */}
      {isLoading && <PageLoader page="Trade Payoff Payments" service="apar-service" />}

      {/* Error */}
      {isError && !isUnauthorized && (
        <PageError error={error as Error} retry={refetch} />
      )}

      {/* List */}
      {!isLoading && !isError && (
        <>
          {(!items || items.length === 0) ? (
            <EmptyState
              icon={<FileText size={22} />}
              title="No trade payoff payments yet"
              description="Create the first payoff record to get started."
              action={<Btn size="sm" onClick={() => setShowCreate(true)}>New Payoff</Btn>}
            />
          ) : (
            <DataTable
              columns={columns}
              data={items}
              onRowClick={(r) => { setSelectedId(r.id); setShowCreate(false); }}
              rowTestIdPrefix="tradepayoff-row"
              emptyTitle="No trade payoff payments"
            />
          )}
        </>
      )}

      {/* Create form panel */}
      {showCreate && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">New Trade Payoff</h2>
            <button onClick={() => { setShowCreate(false); setFormError(null); setForm(emptyForm()); }} className="text-slate-400 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {formError && (
              <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{formError}</div>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Deal Reference <span className="text-red-500">*</span></label>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="DEAL-20240001"
                data-testid="tradepayoff-deal-reference"
                value={form.dealReference}
                onChange={e => setForm(p => ({ ...p, dealReference: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Payee Name <span className="text-red-500">*</span></label>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="First National Bank"
                data-testid="tradepayoff-payee-name"
                value={form.payeeName}
                onChange={e => setForm(p => ({ ...p, payeeName: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Payee Remit Address <span className="text-red-500">*</span></label>
              <textarea
                className="w-full border rounded px-3 py-2 text-sm"
                rows={3}
                placeholder="123 Bank St, Chicago IL 60601"
                data-testid="tradepayoff-remit-address"
                value={form.payeeRemitAddress}
                onChange={e => setForm(p => ({ ...p, payeeRemitAddress: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Payee Reference</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="Loan #, account, or reference number"
                value={form.payeeReference}
                onChange={e => setForm(p => ({ ...p, payeeReference: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Amount <span className="text-red-500">*</span></label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="w-full border rounded px-3 py-2 text-sm font-mono"
                placeholder="0.00"
                data-testid="tradepayoff-amount"
                value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
              />
            </div>
            <div>
              <label htmlFor="goodThroughDate" className="block text-xs font-medium text-slate-600 mb-1">Good Through Date <span className="text-red-500">*</span></label>
              <input
                id="goodThroughDate"
                type="date"
                data-testid="tradepayoff-good-through-date"
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.goodThroughDate}
                onChange={e => setForm(p => ({ ...p, goodThroughDate: e.target.value }))}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Btn type="submit" loading={createMut.isPending} data-testid="tradepayoff-save">Save Payoff</Btn>
              <Btn variant="secondary" type="button" onClick={() => { setShowCreate(false); setFormError(null); setForm(emptyForm()); }}>Cancel</Btn>
            </div>
          </form>
        </div>
      )}

      {/* Detail panel */}
      {selectedId && !showCreate && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Payoff Detail</h2>
            <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-700">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {detailLoading && <PageLoader page="payoff detail" />}
            {detailError && <PageError error={detailErrorObj as Error} />}
            {detail && !detailLoading && (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Deal Reference</dt>
                  <dd className="font-mono text-slate-900">{detail.dealReference}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Payee</dt>
                  <dd className="text-slate-900">{detail.payeeName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Remit Address</dt>
                  <dd className="text-slate-700 whitespace-pre-line">{detail.payeeRemitAddress}</dd>
                </div>
                {detail.payeeReference && (
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Payee Reference</dt>
                    <dd className="font-mono">{detail.payeeReference}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-xs font-medium text-slate-500">Amount</dt>
                  <dd className="font-mono text-lg font-bold text-slate-900" data-testid="tradepayoff-detail-amount">
                    <MoneyCell value={detail.amount} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Good Through</dt>
                  <dd>{detail.goodThroughDate?.slice(0, 10)}</dd>
                </div>
                {detail.status && (
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Status</dt>
                    <dd>
                      <Badge data-testid="tradepayoff-detail-status" variant={detail.status === 'PAID' ? 'success' : detail.status === 'CANCELLED' ? 'danger' : 'info'}>
                        {detail.status}
                      </Badge>
                    </dd>
                  </div>
                )}
                {detail.createdAt && (
                  <div>
                    <dt className="text-xs font-medium text-slate-500">Created</dt>
                    <dd className="text-slate-500">{new Date(detail.createdAt).toLocaleString()}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

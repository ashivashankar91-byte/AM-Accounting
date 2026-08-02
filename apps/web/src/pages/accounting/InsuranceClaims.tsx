/**
 * AMACC S047 — Insurance Claims
 * List, detail, create form, and actions: postSupplement, applyPayment, disposeShortPay.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, ShieldCheck } from 'lucide-react';
import { insuranceClaimApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import {
  Btn, Badge, PageHeader, MoneyCell, EmptyState,
} from '../../components/ui';
import DataTable, { Column } from '../../components/DataTable';

// ─── Types ────────────────────────────────────────────────────────────────────

interface InsuranceClaim {
  id: string;
  customerId: string;
  insurerName: string;
  insurerReference?: string;
  claimNumber: string;
  roReference?: string;
  claimAmount: number | string;
  status?: string;
  paidAmount?: number | string;
  shortPayAmount?: number | string;
  shortPayDisposition?: string;
  supplements?: any[];
  payments?: any[];
  createdAt?: string;
}

function emptyCreateForm() {
  return {
    customerId: '',
    insurerName: '',
    insurerReference: '',
    claimNumber: '',
    roReference: '',
    claimAmount: '',
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InsuranceClaims() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm());
  const [createError, setCreateError] = useState<string | null>(null);

  // Action forms
  const [showSupplementForm, setShowSupplementForm] = useState(false);
  const [supplementForm, setSupplementForm] = useState({ adjustmentAmount: '', reason: '' });
  const [supplementError, setSupplementError] = useState<string | null>(null);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const [showShortPayForm, setShowShortPayForm] = useState(false);
  const [shortPayForm, setShortPayForm] = useState({ dispositionType: '' as '' | 'CUSTOMER_RESPONSIBILITY' | 'WRITE_OFF', reason: '' });
  const [shortPayError, setShortPayError] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const {
    data: claims,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<InsuranceClaim[]>({
    queryKey: ['insurance-claims-list'],
    queryFn: () => insuranceClaimApi.list(),
    retry: false,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErrorObj, refetch: refetchDetail } = useQuery<InsuranceClaim>({
    queryKey: ['insurance-claim', selectedId],
    queryFn: () => insuranceClaimApi.getById(selectedId!),
    enabled: !!selectedId,
    retry: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: () =>
      insuranceClaimApi.create({
        customerId: createForm.customerId,
        insurerName: createForm.insurerName,
        insurerReference: createForm.insurerReference || undefined,
        claimNumber: createForm.claimNumber,
        roReference: createForm.roReference || undefined,
        claimAmount: parseFloat(createForm.claimAmount),
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['insurance-claims-list'] });
      setShowCreate(false);
      setCreateForm(emptyCreateForm());
      setCreateError(null);
      setSelectedId(res.id);
    },
    onError: (err: any) => setCreateError(err?.body?.message || err.message || 'Create failed'),
  });

  const supplementMut = useMutation({
    mutationFn: () =>
      insuranceClaimApi.postSupplement(selectedId!, {
        adjustmentAmount: parseFloat(supplementForm.adjustmentAmount),
        reason: supplementForm.reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance-claim', selectedId] });
      setShowSupplementForm(false);
      setSupplementForm({ adjustmentAmount: '', reason: '' });
      setSupplementError(null);
    },
    onError: (err: any) => setSupplementError(err?.body?.message || err.message || 'Supplement failed'),
  });

  const paymentMut = useMutation({
    mutationFn: () =>
      insuranceClaimApi.applyPayment(selectedId!, { amount: parseFloat(paymentAmount) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance-claim', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['insurance-claims-list'] });
      setShowPaymentForm(false);
      setPaymentAmount('');
      setPaymentError(null);
    },
    onError: (err: any) => setPaymentError(err?.body?.message || err.message || 'Payment failed'),
  });

  const shortPayMut = useMutation({
    mutationFn: () =>
      insuranceClaimApi.disposeShortPay(selectedId!, {
        dispositionType: shortPayForm.dispositionType as 'CUSTOMER_RESPONSIBILITY' | 'WRITE_OFF',
        reason: shortPayForm.reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance-claim', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['insurance-claims-list'] });
      setShowShortPayForm(false);
      setShortPayForm({ dispositionType: '', reason: '' });
      setShortPayError(null);
    },
    onError: (err: any) => setShortPayError(err?.body?.message || err.message || 'Short-pay disposition failed'),
  });

  const isUnauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;

  const columns: Column<InsuranceClaim>[] = [
    { key: 'claimNumber', label: 'Claim #', mono: true },
    { key: 'insurerName', label: 'Insurer' },
    { key: 'roReference', label: 'RO Ref', render: (r) => r.roReference ?? '—' },
    { key: 'claimAmount', label: 'Claim Amount', align: 'right', render: (r) => <MoneyCell value={r.claimAmount} /> },
    { key: 'paidAmount', label: 'Paid', align: 'right', render: (r) => <MoneyCell value={r.paidAmount ?? 0} /> },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Badge variant={r.status === 'CLOSED' ? 'success' : r.status === 'PARTIAL' ? 'warning' : r.status === 'SHORT_PAY' ? 'danger' : 'neutral'}>
          {r.status ?? 'OPEN'}
        </Badge>
      ),
    },
    { key: 'createdAt', label: 'Created', render: (r) => r.createdAt?.slice(0, 10) ?? '—' },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Insurance Claims"
        subtitle="Track insurer claims, supplements, payments, and short-pay dispositions"
        actions={
          <Btn icon={<Plus size={14} />} onClick={() => { setShowCreate(true); setSelectedId(null); }} data-testid="ins-new-open">
            New Claim
          </Btn>
        }
      />

      {isUnauthorized && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          You do not have permission to view insurance claims.
        </div>
      )}

      {isLoading && <PageLoader page="Insurance Claims" service="apar-service" />}
      {isError && !isUnauthorized && <PageError error={error as Error} retry={refetch} />}

      {!isLoading && !isError && (
        claims && claims.length > 0 ? (
          <DataTable
            columns={columns}
            data={claims}
            rowTestIdPrefix="ins-row"
            onRowClick={(r) => { setSelectedId(r.id); setShowCreate(false); }}
          />
        ) : (
          <EmptyState
            icon={<ShieldCheck size={20} />}
            title="No insurance claims"
            description="Create the first claim to start tracking insurance reimbursements."
            action={<Btn size="sm" onClick={() => setShowCreate(true)}>New Claim</Btn>}
          />
        )
      )}

      {/* Create form */}
      {showCreate && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-base font-bold text-slate-900">New Insurance Claim</h2>
            <button onClick={() => { setShowCreate(false); setCreateError(null); setCreateForm(emptyCreateForm()); }} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCreateError(null);
              const amt = parseFloat(createForm.claimAmount);
              if (!createForm.customerId.trim() || !createForm.insurerName.trim() || !createForm.claimNumber.trim() || isNaN(amt) || amt <= 0) {
                setCreateError('Customer ID, insurer name, claim number, and claim amount are required.');
                return;
              }
              createMut.mutate();
            }}
            className="flex-1 overflow-y-auto px-6 py-5 space-y-4"
          >
            {createError && <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{createError}</div>}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Customer ID <span className="text-red-500">*</span></label>
              <input data-testid="ins-customer-id" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="cust-uuid" value={createForm.customerId} onChange={e => setCreateForm(p => ({ ...p, customerId: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Insurer Name <span className="text-red-500">*</span></label>
              <input data-testid="ins-insurer-name" className="w-full border rounded px-3 py-2 text-sm" placeholder="Progressive Insurance" value={createForm.insurerName} onChange={e => setCreateForm(p => ({ ...p, insurerName: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Insurer Reference</label>
              <input className="w-full border rounded px-3 py-2 text-sm" placeholder="Policy or reference number" value={createForm.insurerReference} onChange={e => setCreateForm(p => ({ ...p, insurerReference: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Claim Number <span className="text-red-500">*</span></label>
              <input data-testid="ins-claim-number" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="CLM-20240001" value={createForm.claimNumber} onChange={e => setCreateForm(p => ({ ...p, claimNumber: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">RO Reference</label>
              <input className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="RO-12345" value={createForm.roReference} onChange={e => setCreateForm(p => ({ ...p, roReference: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Claim Amount <span className="text-red-500">*</span></label>
              <input data-testid="ins-claim-amount" type="number" step="0.01" min="0.01" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="0.00" value={createForm.claimAmount} onChange={e => setCreateForm(p => ({ ...p, claimAmount: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <Btn type="submit" loading={createMut.isPending} data-testid="ins-create-submit">Save Claim</Btn>
              <Btn variant="secondary" type="button" onClick={() => { setShowCreate(false); setCreateForm(emptyCreateForm()); setCreateError(null); }}>Cancel</Btn>
            </div>
          </form>
        </div>
      )}

      {/* Detail panel */}
      {selectedId && !showCreate && (
        <div className="fixed inset-y-0 right-0 w-[560px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50 overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-base font-bold text-slate-900">Claim Detail</h2>
            <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>

          {detailLoading && <PageLoader page="claim detail" />}
          {detailError && <PageError error={detailErrorObj as Error} retry={refetchDetail} />}

          {detail && !detailLoading && (
            <div className="px-6 py-5 space-y-6">
              {/* Summary */}
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-slate-500">Claim Number</dt><dd className="font-mono font-semibold">{detail.claimNumber}</dd></div>
                <div><dt className="text-xs text-slate-500">Status</dt><dd><Badge data-testid="ins-detail-status" variant={detail.status === 'CLOSED' ? 'success' : detail.status === 'SHORT_PAY' ? 'danger' : 'neutral'}>{detail.status ?? 'OPEN'}</Badge></dd></div>
                <div><dt className="text-xs text-slate-500">Insurer</dt><dd>{detail.insurerName}</dd></div>
                <div><dt className="text-xs text-slate-500">RO Reference</dt><dd className="font-mono">{detail.roReference ?? '—'}</dd></div>
                <div><dt className="text-xs text-slate-500">Claim Amount</dt><dd className="font-mono font-bold"><MoneyCell value={detail.claimAmount} /></dd></div>
                <div><dt className="text-xs text-slate-500">Paid Amount</dt><dd className="font-mono text-emerald-700" data-testid="ins-paid-amount"><MoneyCell value={detail.paidAmount ?? 0} /></dd></div>
                {detail.shortPayAmount != null && (
                  <div><dt className="text-xs text-slate-500">Short-Pay Amount</dt><dd className="font-mono text-red-600" data-testid="ins-shortpay-amount"><MoneyCell value={detail.shortPayAmount} /></dd></div>
                )}
                {detail.shortPayDisposition && (
                  <div><dt className="text-xs text-slate-500">Short-Pay Disposition</dt><dd><Badge variant="warning" data-testid="ins-shortpay-disposition">{detail.shortPayDisposition}</Badge></dd></div>
                )}
              </dl>

              {/* Supplements */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-700">Supplements</h3>
                  <Btn size="sm" variant="secondary" onClick={() => setShowSupplementForm(p => !p)} data-testid="ins-supplement-toggle">
                    {showSupplementForm ? 'Cancel' : 'Post Supplement'}
                  </Btn>
                </div>
                {showSupplementForm && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setSupplementError(null);
                      const amt = parseFloat(supplementForm.adjustmentAmount);
                      if (isNaN(amt) || amt === 0) { setSupplementError('Adjustment amount must be non-zero.'); return; }
                      if (!supplementForm.reason.trim()) { setSupplementError('Reason is required.'); return; }
                      supplementMut.mutate();
                    }}
                    className="mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
                  >
                    {supplementError && <div className="text-xs text-red-600">{supplementError}</div>}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Adjustment Amount (non-zero) <span className="text-red-500">*</span></label>
                      <input data-testid="ins-supplement-amount" type="number" step="0.01" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="-100.00 or 250.00" value={supplementForm.adjustmentAmount} onChange={e => setSupplementForm(p => ({ ...p, adjustmentAmount: e.target.value }))} required />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Reason <span className="text-red-500">*</span></label>
                      <input className="w-full border rounded px-3 py-2 text-sm" value={supplementForm.reason} onChange={e => setSupplementForm(p => ({ ...p, reason: e.target.value }))} required />
                    </div>
                    <div className="flex gap-2">
                      <Btn size="sm" type="submit" loading={supplementMut.isPending} data-testid="ins-supplement-submit">Post</Btn>
                      <Btn size="sm" variant="secondary" type="button" onClick={() => { setShowSupplementForm(false); setSupplementForm({ adjustmentAmount: '', reason: '' }); setSupplementError(null); }}>Cancel</Btn>
                    </div>
                  </form>
                )}
                {detail.supplements && detail.supplements.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead><tr className="border-b text-slate-500"><th className="py-1 text-left">Date</th><th className="py-1 text-left">Reason</th><th className="py-1 text-right">Adjustment</th></tr></thead>
                    <tbody>
                      {detail.supplements.map((s: any, i: number) => (
                        <tr key={s.id ?? i} className="border-b border-slate-50">
                          <td className="py-1.5">{s.createdAt?.slice(0, 10) ?? '—'}</td>
                          <td className="py-1.5 text-slate-600">{s.reason}</td>
                          <td className="py-1.5 text-right font-mono"><MoneyCell value={s.adjustmentAmount} colorCode="auto" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-slate-400">No supplements posted.</p>
                )}
              </div>

              {/* Apply Payment */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-700">Payments</h3>
                  {detail.status !== 'CLOSED' && (
                    <Btn size="sm" variant="secondary" onClick={() => setShowPaymentForm(p => !p)} data-testid="ins-payment-toggle">
                      {showPaymentForm ? 'Cancel' : 'Apply Payment'}
                    </Btn>
                  )}
                </div>
                {showPaymentForm && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      setPaymentError(null);
                      const amt = parseFloat(paymentAmount);
                      if (isNaN(amt) || amt <= 0) { setPaymentError('Amount must be positive.'); return; }
                      paymentMut.mutate();
                    }}
                    className="mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
                  >
                    {paymentError && <div className="text-xs text-red-600">{paymentError}</div>}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Payment Amount <span className="text-red-500">*</span></label>
                      <input data-testid="ins-payment-amount" type="number" step="0.01" min="0.01" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="0.00" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} required />
                    </div>
                    <div className="flex gap-2">
                      <Btn size="sm" type="submit" loading={paymentMut.isPending} data-testid="ins-payment-submit">Apply</Btn>
                      <Btn size="sm" variant="secondary" type="button" onClick={() => { setShowPaymentForm(false); setPaymentAmount(''); setPaymentError(null); }}>Cancel</Btn>
                    </div>
                  </form>
                )}
                {detail.payments && detail.payments.length > 0 ? (
                  <table className="w-full text-xs">
                    <thead><tr className="border-b text-slate-500"><th className="py-1 text-left">Date</th><th className="py-1 text-right">Amount</th></tr></thead>
                    <tbody>
                      {detail.payments.map((p: any, i: number) => (
                        <tr key={p.id ?? i} className="border-b border-slate-50">
                          <td className="py-1.5">{p.paymentDate?.slice(0, 10) ?? p.createdAt?.slice(0, 10) ?? '—'}</td>
                          <td className="py-1.5 text-right font-mono"><MoneyCell value={p.amount} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-slate-400">No payments applied yet.</p>
                )}
              </div>

              {/* Short-pay disposition */}
              {detail.status !== 'CLOSED' && !detail.shortPayDisposition && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-700">Short-Pay Disposition</h3>
                    <Btn size="sm" variant="ghost" onClick={() => setShowShortPayForm(p => !p)} data-testid="ins-shortpay-toggle">
                      {showShortPayForm ? 'Cancel' : 'Dispose Short-Pay'}
                    </Btn>
                  </div>
                  {showShortPayForm && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        setShortPayError(null);
                        if (!shortPayForm.dispositionType || !shortPayForm.reason.trim()) {
                          setShortPayError('Disposition type and reason are required.');
                          return;
                        }
                        shortPayMut.mutate();
                      }}
                      className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
                    >
                      {shortPayError && <div className="text-xs text-red-600">{shortPayError}</div>}
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Disposition Type <span className="text-red-500">*</span></label>
                        <select data-testid="ins-shortpay-disposition-select" className="w-full border rounded px-3 py-2 text-sm" value={shortPayForm.dispositionType} onChange={e => setShortPayForm(p => ({ ...p, dispositionType: e.target.value as any }))} required>
                          <option value="">— Select —</option>
                          <option value="CUSTOMER_RESPONSIBILITY">CUSTOMER_RESPONSIBILITY</option>
                          <option value="WRITE_OFF">WRITE_OFF</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Reason <span className="text-red-500">*</span></label>
                        <textarea data-testid="ins-shortpay-reason" rows={3} className="w-full border rounded px-3 py-2 text-sm" value={shortPayForm.reason} onChange={e => setShortPayForm(p => ({ ...p, reason: e.target.value }))} required />
                      </div>
                      <div className="flex gap-2">
                        <Btn size="sm" type="submit" loading={shortPayMut.isPending} data-testid="ins-shortpay-confirm">Confirm</Btn>
                        <Btn size="sm" variant="secondary" type="button" onClick={() => { setShowShortPayForm(false); setShortPayForm({ dispositionType: '', reason: '' }); setShortPayError(null); }}>Cancel</Btn>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

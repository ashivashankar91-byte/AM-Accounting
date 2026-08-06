/**
 * AMACC-CH04 S043A — Manual Payments with full lifecycle
 * Void (with VOID_REFUSED_PAYMENT_RECONCILED 409 banner),
 * stop-payment request+resolve, reissue, due-diligence (escheat),
 * escheat queue + transfer (with ESCHEAT_CONFIG_NOT_FOUND 422 banner).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ShieldOff, RefreshCw } from 'lucide-react';
import { manualPaymentApi, paymentLifecycleApi, bankAccountApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import DataTable from '../../components/DataTable';
import { Badge, Btn } from '../../components/ui';

type Tab = 'payments' | 'escheat-queue';

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'POSTED' || status === 'CLEARED') return 'success';
  if (status === 'VOIDED' || status === 'STOPPED') return 'danger';
  if (status === 'STOP_REQUESTED') return 'warning';
  return 'neutral';
}

function PaymentDetail({ payment, onClose }: { payment: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [voidError, setVoidError] = useState<{ reconciled: boolean; msg: string } | null>(null);

  const [stopReason, setStopReason] = useState('');
  const [showStop, setShowStop] = useState(false);

  const [showReissue, setShowReissue] = useState(false);
  const [reissueBankId, setReissueBankId] = useState('');

  const [showDueDiligence, setShowDueDiligence] = useState(false);
  const [ddForm, setDdForm] = useState({ method: 'LETTER', outcome: '', notes: '' });

  const [inlineError, setInlineError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const notify = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); };
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['manual-payments'] });
    queryClient.invalidateQueries({ queryKey: ['stop-payment-requests', payment.id] });
    queryClient.invalidateQueries({ queryKey: ['due-diligence', payment.id] });
  };

  const { data: stopRequests = [] } = useQuery({
    queryKey: ['stop-payment-requests', payment.id],
    queryFn: () => paymentLifecycleApi.getStopPaymentRequests(payment.id),
    retry: false,
  });

  const { data: dueDiligenceRecords = [] } = useQuery({
    queryKey: ['due-diligence', payment.id],
    queryFn: () => paymentLifecycleApi.getDueDiligence(payment.id),
    retry: false,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => bankAccountApi.list(),
    retry: false,
    enabled: showReissue,
  });

  const voidMut = useMutation({
    mutationFn: () => manualPaymentApi.void(payment.id, { version: payment.version, reason: voidReason }),
    onSuccess: () => { invalidate(); setShowVoid(false); notify('Payment voided.'); },
    onError: (err: any) => {
      setShowVoid(false);
      // 409 VOID_REFUSED_PAYMENT_RECONCILED — show a prominent reconciled-void banner
      if (err?.status === 409 && (err?.body?.error === 'VOID_REFUSED_PAYMENT_RECONCILED' || err?.body?.code === 'VOID_REFUSED_PAYMENT_RECONCILED')) {
        setVoidError({ reconciled: true, msg: err?.body?.message ?? 'This payment has been reconciled and cannot be voided.' });
      } else {
        setVoidError({ reconciled: false, msg: err?.body?.message ?? err.message ?? 'Void failed' });
      }
    },
  });

  const stopMut = useMutation({
    mutationFn: () => paymentLifecycleApi.requestStopPayment(payment.id, { reason: stopReason }),
    onSuccess: () => { invalidate(); setShowStop(false); notify('Stop payment requested.'); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Stop payment failed'),
  });

  const reissueMut = useMutation({
    mutationFn: () => paymentLifecycleApi.reissue(payment.id, { bankAccountId: reissueBankId }),
    onSuccess: () => { invalidate(); setShowReissue(false); notify('Payment reissued.'); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Reissue failed'),
  });

  const ddMut = useMutation({
    mutationFn: () => paymentLifecycleApi.recordDueDiligence(payment.id, {
      method: ddForm.method as any,
      outcome: ddForm.outcome,
      notes: ddForm.notes || undefined,
    }),
    onSuccess: () => { invalidate(); setShowDueDiligence(false); notify('Due diligence recorded.'); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Due diligence failed'),
  });

  const resolveStopMut = useMutation({
    mutationFn: (requestId: string) => paymentLifecycleApi.resolveStopPayment(requestId, {
      status: 'ACKNOWLEDGED', bankAck: 'MANUAL',
    }),
    onSuccess: () => { invalidate(); notify('Stop payment resolved.'); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Resolve failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[42rem] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-lg">Payment #{payment.checkNumber ?? payment.id}</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              ${Number(payment.amount ?? 0).toFixed(2)} · <Badge data-testid="manpay-status" variant={statusVariant(payment.status)}>{payment.status}</Badge>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {notification && (
          <div className="bg-green-50 border border-green-200 rounded p-2 text-sm text-green-700">{notification}</div>
        )}

        {/* Reconciled-void refusal banner */}
        {voidError?.reconciled && (
          <div data-testid="manpay-void-refused-reconciled" className="bg-red-50 border-l-4 border-red-500 rounded p-3 space-y-1">
            <p className="font-semibold text-red-800 text-sm">Void Refused — Payment Reconciled</p>
            <p className="text-sm text-red-700">{voidError.msg}</p>
            <p className="text-xs text-red-600">This payment has been matched against a cleared bank transaction. It cannot be voided. To correct this, issue a reversing journal entry.</p>
          </div>
        )}
        {voidError && !voidError.reconciled && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{voidError.msg}</div>
        )}

        {inlineError && (
          <div className="bg-red-50 border border-red-200 rounded p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{inlineError}</p>
          </div>
        )}

        {/* Payment metadata */}
        <dl className="grid grid-cols-2 gap-2 text-sm border rounded-lg p-3">
          <div><dt className="text-xs text-gray-500">Invoice</dt><dd className="font-mono">{payment.invoiceId ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Vendor</dt><dd>{payment.vendorId ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Check #</dt><dd>{payment.checkNumber ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Payment Date</dt><dd>{payment.paymentDate ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">GL Entry</dt><dd className="font-mono">{payment.glEntryId ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Schedule Relief</dt><dd>{payment.scheduleReliefStatus ?? '—'}</dd></div>
        </dl>

        {/* Action buttons */}
        {payment.status !== 'VOIDED' && !showVoid && !showStop && !showReissue && !showDueDiligence && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setVoidError(null); setShowVoid(true); }}
              data-testid="manpay-void-open"
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
            >
              Void
            </button>
            <button
              onClick={() => setShowStop(true)}
              data-testid="manpay-stop-open"
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
            >
              Stop Payment
            </button>
            <button
              onClick={() => setShowReissue(true)}
              data-testid="manpay-reissue-open"
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
            >
              Reissue
            </button>
            <button
              onClick={() => setShowDueDiligence(true)}
              data-testid="manpay-dd-open"
              className="px-3 py-1.5 text-sm border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50"
            >
              Record Due Diligence
            </button>
          </div>
        )}

        {showVoid && (
          <div className="space-y-2 border rounded-lg p-3">
            <label className="block text-xs font-medium text-gray-600">Void Reason *</label>
            <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} rows={2} className="w-full border rounded px-3 py-2 text-sm" placeholder="Required" data-testid="manpay-void-reason" />
            <div className="flex gap-2">
              <button onClick={() => voidMut.mutate()} disabled={voidMut.isPending || !voidReason.trim()} data-testid="manpay-void-confirm" className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-40">
                {voidMut.isPending ? 'Voiding…' : 'Confirm Void'}
              </button>
              <button onClick={() => setShowVoid(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {showStop && (
          <div className="space-y-2 border rounded-lg p-3">
            <label className="block text-xs font-medium text-gray-600">Stop Payment Reason *</label>
            <textarea value={stopReason} onChange={e => setStopReason(e.target.value)} rows={2} className="w-full border rounded px-3 py-2 text-sm" placeholder="Required" />
            <div className="flex gap-2">
              <button onClick={() => stopMut.mutate()} disabled={stopMut.isPending || !stopReason.trim()} className="px-4 py-2 bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-40">
                {stopMut.isPending ? 'Requesting…' : 'Request Stop'}
              </button>
              <button onClick={() => setShowStop(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {showReissue && (
          <div className="space-y-2 border rounded-lg p-3">
            <label className="block text-xs font-medium text-gray-600">Bank Account *</label>
            <select value={reissueBankId} onChange={e => setReissueBankId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm" data-testid="manpay-reissue-bank">
              <option value="">— select —</option>
              {(bankAccounts as any[]).map((ba: any) => (
                <option key={ba.id} value={ba.id}>{ba.bankName} …{ba.accountNumber?.slice(-4)}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={() => reissueMut.mutate()} disabled={reissueMut.isPending || !reissueBankId} data-testid="manpay-reissue-confirm" className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium disabled:opacity-40">
                {reissueMut.isPending ? 'Reissuing…' : 'Reissue'}
              </button>
              <button onClick={() => setShowReissue(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {showDueDiligence && (
          <div className="space-y-2 border rounded-lg p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase">Record Due Diligence (Escheat)</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
              <select value={ddForm.method} onChange={e => setDdForm(f => ({ ...f, method: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm">
                <option value="LETTER">Letter</option>
                <option value="PHONE">Phone</option>
                <option value="EMAIL">Email</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Outcome *</label>
              <input type="text" value={ddForm.outcome} onChange={e => setDdForm(f => ({ ...f, outcome: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm" placeholder="e.g. No response" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea value={ddForm.notes} onChange={e => setDdForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => ddMut.mutate()} disabled={ddMut.isPending || !ddForm.outcome.trim()} className="px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium disabled:opacity-40">
                {ddMut.isPending ? 'Saving…' : 'Record'}
              </button>
              <button onClick={() => setShowDueDiligence(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {/* Stop Payment Requests list */}
        {(stopRequests as any[]).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Stop Payment Requests</p>
            <div className="space-y-2">
              {(stopRequests as any[]).map((req: any) => (
                <div key={req.id} className="border rounded p-2 text-xs flex items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{req.reason ?? '—'}</span>
                    <span className="text-gray-400 ml-2">{req.status ?? '—'}</span>
                  </div>
                  {req.status === 'PENDING' && (
                    <button
                      onClick={() => resolveStopMut.mutate(req.id)}
                      disabled={resolveStopMut.isPending}
                      className="px-2 py-1 bg-gray-700 text-white rounded text-xs font-medium disabled:opacity-40"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Due Diligence records */}
        {(dueDiligenceRecords as any[]).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Due Diligence History</p>
            <div className="space-y-1">
              {(dueDiligenceRecords as any[]).map((dd: any, i: number) => (
                <div key={dd.id ?? i} className="text-xs border-b pb-1 last:border-0">
                  <span className="font-medium">{dd.method}</span> — {dd.outcome}
                  {dd.notes && <span className="text-gray-400"> · {dd.notes}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EscheatQueue() {
  const [jurisdictions, setJurisdictions] = useState<Record<string, string>>({});
  const [escheatErrors, setEscheatErrors] = useState<Record<string, { noConfig: boolean; msg: string }>>({});
  const [escheatSuccess, setEscheatSuccess] = useState<Record<string, boolean>>({});
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['escheat-queue'],
    queryFn: () => paymentLifecycleApi.getEscheatQueue(),
    retry: false,
  });

  const escheatMut = useMutation({
    mutationFn: ({ id, jurisdiction }: { id: string; jurisdiction: string }) =>
      paymentLifecycleApi.postEscheatTransfer(id, { jurisdiction }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['escheat-queue'] });
      setEscheatSuccess(s => ({ ...s, [vars.id]: true }));
    },
    onError: (err: any, vars) => {
      if (err?.status === 422 && (err?.body?.error === 'ESCHEAT_CONFIG_NOT_FOUND' || err?.body?.code === 'ESCHEAT_CONFIG_NOT_FOUND')) {
        setEscheatErrors(e => ({ ...e, [vars.id]: { noConfig: true, msg: err?.body?.message ?? 'No escheat jurisdiction configured.' } }));
      } else {
        setEscheatErrors(e => ({ ...e, [vars.id]: { noConfig: false, msg: err?.body?.message ?? err.message ?? 'Escheat transfer failed' } }));
      }
    },
  });

  const items: any[] = Array.isArray(data) ? data : [];

  if (isLoading) return <p className="text-sm text-gray-400 p-4">Loading escheat queue…</p>;
  if (isError) return <PageError error={error as Error} retry={refetch} />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">{items.length} payment{items.length !== 1 ? 's' : ''} in escheat queue</p>
      {items.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <p className="text-4xl mb-2">🏛️</p>
          <p className="text-sm font-medium">No payments in escheat queue</p>
        </div>
      )}
      {items.map((item: any) => (
        <div key={item.id} className="border rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Payment #{item.checkNumber ?? item.id}</p>
              <p className="text-xs text-gray-500">${Number(item.amount ?? 0).toFixed(2)} · {item.vendorId ?? '—'}</p>
            </div>
            <Badge variant="warning">{item.escheatStatus ?? item.status ?? 'PENDING'}</Badge>
          </div>

          {escheatErrors[item.id]?.noConfig && (
            <div data-testid={`manpay-escheat-no-config-${item.id}`} className="bg-amber-50 border-l-4 border-amber-400 rounded p-3">
              <p className="font-semibold text-amber-800 text-sm">No Escheat Jurisdiction Configured — Informational Only</p>
              <p className="text-sm text-amber-700 mt-0.5">{escheatErrors[item.id].msg}</p>
              <p className="text-xs text-amber-600 mt-1">Transfer refused by server. Configure an escheat jurisdiction in system settings before attempting this transfer.</p>
            </div>
          )}
          {escheatErrors[item.id] && !escheatErrors[item.id].noConfig && (
            <div className="bg-red-50 border border-red-200 rounded p-2 text-sm text-red-700">{escheatErrors[item.id].msg}</div>
          )}
          {escheatSuccess[item.id] && (
            <div className="bg-green-50 border border-green-200 rounded p-2 text-sm text-green-700">Escheat transfer posted.</div>
          )}

          {!escheatSuccess[item.id] && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={jurisdictions[item.id] ?? ''}
                onChange={e => setJurisdictions(j => ({ ...j, [item.id]: e.target.value }))}
                placeholder="Jurisdiction (e.g. CA)"
                data-testid={`manpay-escheat-jurisdiction-${item.id}`}
                className="border rounded px-3 py-1.5 text-sm w-40"
              />
              <button
                onClick={() => escheatMut.mutate({ id: item.id, jurisdiction: jurisdictions[item.id] ?? '' })}
                disabled={escheatMut.isPending || !jurisdictions[item.id]?.trim()}
                data-testid={`manpay-escheat-submit-${item.id}`}
                className="px-3 py-1.5 text-sm bg-gray-700 text-white rounded-lg font-medium disabled:opacity-40"
              >
                {escheatMut.isPending ? 'Posting…' : 'Post Escheat Transfer'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ManualPayments() {
  const [tab, setTab] = useState<Tab>('payments');
  const [selectedPayment, setSelectedPayment] = useState<any | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['manual-payments'],
    queryFn: () => manualPaymentApi.list(),
    retry: false,
    enabled: tab === 'payments',
  });

  const err = error as any;

  if (tab === 'payments' && isLoading) return <PageLoader page="Manual Payments" service="apar-service" port={3013} />;
  if (tab === 'payments' && isError) {
    if (err?.status === 401 || err?.status === 403) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <ShieldOff className="w-10 h-10 mx-auto mb-3 text-amber-400" />
            <p className="text-sm text-gray-600">You do not have permission to view manual payments.</p>
          </div>
        </div>
      );
    }
    return <PageError error={error as Error} retry={refetch} serviceName="apar-service" port={3013} />;
  }

  const payments: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Manual Payments</h1>
        <p className="text-sm text-gray-500 mt-0.5">Payment lifecycle: void, stop, reissue, due diligence, escheat</p>
      </div>

      <div className="border-b flex gap-0">
        {(['payments', 'escheat-queue'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700',
            ].join(' ')}
          >
            {t === 'payments' ? 'Payments' : 'Escheat Queue'}
          </button>
        ))}
      </div>

      {tab === 'payments' && (
        <DataTable
          columns={[
            { key: 'checkNumber', label: 'Check #', mono: true },
            { key: 'invoiceId', label: 'Invoice', mono: true },
            { key: 'vendorId', label: 'Vendor' },
            { key: 'amount', label: 'Amount', align: 'right', render: (row) => `$${Number(row.amount ?? 0).toFixed(2)}` },
            { key: 'paymentDate', label: 'Date' },
            { key: 'status', label: 'Status', render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge> },
            { key: 'scheduleReliefStatus', label: 'Relief', render: (row) => row.scheduleReliefStatus ?? '—' },
            { key: 'actions', label: '', render: (row) => (
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedPayment(row); }}
                className="text-xs text-brand hover:underline font-medium"
              >
                Manage
              </button>
            )},
          ]}
          data={payments}
          onRowClick={(row) => setSelectedPayment(row)}
          rowTestIdPrefix="manpay-row"
          emptyIcon="💸"
          emptyTitle="No manual payments"
          emptySubtitle="Payments created from approved invoices will appear here."
        />
      )}

      {tab === 'escheat-queue' && <EscheatQueue />}

      {selectedPayment && <PaymentDetail payment={selectedPayment} onClose={() => setSelectedPayment(null)} />}
    </div>
  );
}

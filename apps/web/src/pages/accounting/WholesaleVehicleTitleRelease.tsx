/**
 * AMACC S048 — Wholesale Vehicle Title Release
 * SECURITY CRITICAL: releaseTitle requires paid-in-full gate (server returns
 * 409 TITLE_RELEASE_REFUSED_UNPAID). releaseTitleException is a DISTINCT
 * audited path requiring a mandatory reason and is permanently logged.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Car, AlertTriangle, ShieldAlert } from 'lucide-react';
import { wholesaleVehicleApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import {
  Btn, Badge, PageHeader, MoneyCell, EmptyState, LoadingTable,
} from '../../components/ui';
import DataTable, { Column } from '../../components/DataTable';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WholesaleItem {
  id: string;
  customerId: string;
  vehicleVin: string;
  saleAmount: number | string;
  amountPaid?: number | string;
  titleStatus?: string;
  status?: string;
  createdAt?: string;
  payments?: any[];
}

interface TitleException {
  id: string;
  actor?: string;
  performedBy?: string;
  reason: string;
  createdAt?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WholesaleVehicleTitleRelease() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ customerId: '', vehicleVin: '', saleAmount: '' });
  const [createError, setCreateError] = useState<string | null>(null);

  // Title release state
  const [titleRefused, setTitleRefused] = useState(false);
  const [titleRefusalDetail, setTitleRefusalDetail] = useState<string | null>(null);
  const [titleSuccess, setTitleSuccess] = useState(false);

  // Exception dialog state
  const [showExceptionDialog, setShowExceptionDialog] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionError, setExceptionError] = useState<string | null>(null);

  // Record payment state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const {
    data: items,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<WholesaleItem[]>({
    queryKey: ['wholesale-vehicle-list'],
    queryFn: () => wholesaleVehicleApi.list(),
    retry: false,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError, error: detailErrorObj, refetch: refetchDetail } = useQuery<WholesaleItem>({
    queryKey: ['wholesale-vehicle', selectedId],
    queryFn: () => wholesaleVehicleApi.getById(selectedId!),
    enabled: !!selectedId,
    retry: false,
  });

  const { data: exceptions, refetch: refetchExceptions } = useQuery<TitleException[]>({
    queryKey: ['wholesale-vehicle-exceptions', selectedId],
    queryFn: () => wholesaleVehicleApi.getReleaseExceptions(selectedId!),
    enabled: !!selectedId,
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: () =>
      wholesaleVehicleApi.create({
        customerId: createForm.customerId,
        vehicleVin: createForm.vehicleVin,
        saleAmount: parseFloat(createForm.saleAmount),
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['wholesale-vehicle-list'] });
      setShowCreate(false);
      setCreateForm({ customerId: '', vehicleVin: '', saleAmount: '' });
      setSelectedId(res.id);
    },
    onError: (err: any) => setCreateError(err?.body?.message || err.message || 'Create failed'),
  });

  const recordPaymentMut = useMutation({
    mutationFn: () =>
      wholesaleVehicleApi.recordPayment(selectedId!, { amount: parseFloat(paymentAmount) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wholesale-vehicle', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['wholesale-vehicle-list'] });
      setShowPaymentForm(false);
      setPaymentAmount('');
      setPaymentError(null);
    },
    onError: (err: any) => setPaymentError(err?.body?.message || err.message || 'Payment failed'),
  });

  const releaseTitleMut = useMutation({
    mutationFn: () => wholesaleVehicleApi.releaseTitle(selectedId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wholesale-vehicle', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['wholesale-vehicle-list'] });
      setTitleRefused(false);
      setTitleSuccess(true);
    },
    onError: (err: any) => {
      if (err?.status === 409 || err?.body?.error === 'TITLE_RELEASE_REFUSED_UNPAID') {
        setTitleRefused(true);
        setTitleSuccess(false);
        const outstanding = err?.body?.outstandingBalance;
        setTitleRefusalDetail(
          outstanding != null
            ? `Outstanding balance: $${Number(outstanding).toFixed(2)}`
            : (err?.body?.message || 'The vehicle has not been paid in full.'),
        );
      } else {
        setTitleRefused(false);
        setTitleRefusalDetail(null);
      }
    },
  });

  const releaseTitleExceptionMut = useMutation({
    mutationFn: () =>
      wholesaleVehicleApi.releaseTitleException(selectedId!, { reason: exceptionReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wholesale-vehicle', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['wholesale-vehicle-list'] });
      refetchExceptions();
      setShowExceptionDialog(false);
      setExceptionReason('');
      setExceptionError(null);
      setTitleRefused(false);
      setTitleSuccess(true);
    },
    onError: (err: any) => {
      if (err?.status === 403) {
        setExceptionError('You do not have permission to release titles via exception.');
      } else {
        setExceptionError(err?.body?.message || err.message || 'Exception release failed');
      }
    },
  });

  const isUnauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;

  const saleAmt = detail ? Number(detail.saleAmount || 0) : 0;
  const paidAmt = detail ? Number((detail as any).amountPaid || 0) : 0;
  const outstanding = saleAmt - paidAmt;

  const columns: Column<WholesaleItem>[] = [
    { key: 'vehicleVin', label: 'VIN', mono: true, width: '180px' },
    { key: 'customerId', label: 'Customer ID', mono: true },
    { key: 'saleAmount', label: 'Sale Amount', align: 'right', render: (r) => <MoneyCell value={r.saleAmount} /> },
    { key: 'amountPaid', label: 'Amount Paid', align: 'right', render: (r) => <MoneyCell value={(r as any).amountPaid ?? 0} /> },
    {
      key: 'titleStatus',
      label: 'Title Status',
      render: (r) => {
        const s = r.titleStatus ?? 'PENDING';
        return (
          <Badge variant={s === 'RELEASED' ? 'success' : s === 'EXCEPTION' ? 'warning' : 'neutral'}>
            {s}
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Wholesale Vehicle Title Release"
        subtitle="Track vehicle sale payments and manage title release"
        actions={
          <Btn icon={<Plus size={14} />} onClick={() => { setShowCreate(true); setSelectedId(null); }} data-testid="wvtr-new-open">
            New Vehicle
          </Btn>
        }
      />

      {isUnauthorized && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          You do not have permission to manage wholesale vehicle title releases.
        </div>
      )}

      {isLoading && <PageLoader page="Wholesale Vehicles" service="apar-service" />}
      {isError && !isUnauthorized && <PageError error={error as Error} retry={refetch} />}

      {!isLoading && !isError && (
        <>
          {(!items || items.length === 0) ? (
            <EmptyState
              icon={<Car size={22} />}
              title="No wholesale vehicle items"
              description="Add the first vehicle to begin tracking title releases."
              action={<Btn size="sm" onClick={() => setShowCreate(true)}>New Vehicle</Btn>}
            />
          ) : (
            <DataTable
              columns={columns}
              data={items}
              rowTestIdPrefix="wvtr-row"
              onRowClick={(r) => {
                setSelectedId(r.id);
                setShowCreate(false);
                setTitleRefused(false);
                setTitleSuccess(false);
              }}
            />
          )}
        </>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-base font-bold text-slate-900">New Wholesale Vehicle</h2>
            <button onClick={() => { setShowCreate(false); setCreateError(null); }} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); setCreateError(null); createMut.mutate(); }} className="flex-1 p-6 space-y-4">
            {createError && <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{createError}</div>}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Customer ID <span className="text-red-500">*</span></label>
              <input data-testid="wvtr-customer-id" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="cust-uuid" value={createForm.customerId} onChange={e => setCreateForm(p => ({ ...p, customerId: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vehicle VIN <span className="text-red-500">*</span></label>
              <input data-testid="wvtr-vin" className="w-full border rounded px-3 py-2 text-sm font-mono uppercase" placeholder="1HGBH41JXMN109186" value={createForm.vehicleVin} onChange={e => setCreateForm(p => ({ ...p, vehicleVin: e.target.value.toUpperCase() }))} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Sale Amount <span className="text-red-500">*</span></label>
              <input data-testid="wvtr-sale-amount" type="number" step="0.01" min="0.01" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="0.00" value={createForm.saleAmount} onChange={e => setCreateForm(p => ({ ...p, saleAmount: e.target.value }))} required />
            </div>
            <div className="flex gap-3 pt-2">
              <Btn type="submit" loading={createMut.isPending} data-testid="wvtr-create-save">Save</Btn>
              <Btn variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Btn>
            </div>
          </form>
        </div>
      )}

      {/* Detail panel */}
      {selectedId && !showCreate && (
        <div className="fixed inset-y-0 right-0 w-[560px] bg-white shadow-2xl border-l border-slate-200 flex flex-col z-50 overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b">
            <h2 className="text-base font-bold text-slate-900">Vehicle Detail</h2>
            <button onClick={() => { setSelectedId(null); setTitleRefused(false); setTitleSuccess(false); }} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
          </div>

          {detailLoading && <PageLoader page="vehicle detail" />}
          {detailError && <PageError error={detailErrorObj as Error} retry={refetchDetail} />}

          {detail && !detailLoading && (
            <div className="px-6 py-5 space-y-6">
              {/* Summary */}
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-slate-500">VIN</dt>
                  <dd className="font-mono font-semibold text-slate-900">{detail.vehicleVin}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Title Status</dt>
                  <dd>
                    <Badge data-testid="wvtr-title-status" variant={(detail.titleStatus ?? 'PENDING') === 'RELEASED' ? 'success' : (detail.titleStatus ?? 'PENDING') === 'EXCEPTION' ? 'warning' : 'neutral'}>
                      {detail.titleStatus ?? 'PENDING'}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Sale Amount</dt>
                  <dd className="font-mono"><MoneyCell value={detail.saleAmount} /></dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Amount Paid</dt>
                  <dd className="font-mono"><MoneyCell value={(detail as any).amountPaid ?? 0} /></dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Outstanding</dt>
                  <dd className={`font-mono font-semibold ${outstanding > 0 ? 'text-red-600' : 'text-emerald-600'}`} data-testid="wvtr-outstanding">
                    <MoneyCell value={outstanding} />
                  </dd>
                </div>
              </dl>

              {/* Payment history */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-700">Payment History</h3>
                  {detail.titleStatus !== 'RELEASED' && (
                    <Btn size="sm" variant="secondary" onClick={() => setShowPaymentForm(p => !p)} data-testid="wvtr-payment-toggle">
                      {showPaymentForm ? 'Cancel' : 'Record Payment'}
                    </Btn>
                  )}
                </div>

                {showPaymentForm && (
                  <form
                    onSubmit={(e) => { e.preventDefault(); setPaymentError(null); recordPaymentMut.mutate(); }}
                    className="mb-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3"
                  >
                    {paymentError && <div className="text-xs text-red-600">{paymentError}</div>}
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Payment Amount</label>
                      <input data-testid="wvtr-payment-amount" type="number" step="0.01" min="0.01" className="w-full border rounded px-3 py-2 text-sm font-mono" placeholder="0.00" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} required />
                    </div>
                    <div className="flex gap-2">
                      <Btn size="sm" type="submit" loading={recordPaymentMut.isPending} data-testid="wvtr-payment-submit">Record</Btn>
                      <Btn size="sm" variant="secondary" type="button" onClick={() => { setShowPaymentForm(false); setPaymentAmount(''); setPaymentError(null); }}>Cancel</Btn>
                    </div>
                  </form>
                )}

                {(detail.payments && detail.payments.length > 0) ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-slate-500">
                        <th className="py-1 text-left">Date</th>
                        <th className="py-1 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.map((p: any, i: number) => (
                        <tr key={p.id ?? i} className="border-b border-slate-50">
                          <td className="py-1.5 text-slate-600">{p.paymentDate?.slice(0, 10) ?? p.createdAt?.slice(0, 10) ?? '—'}</td>
                          <td className="py-1.5 text-right font-mono"><MoneyCell value={p.amount} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-xs text-slate-400 py-2">No payments recorded yet.</p>
                )}
              </div>

              {/* Title release actions */}
              {detail.titleStatus !== 'RELEASED' && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-700">Title Release</h3>

                  {/* Success confirmation */}
                  {titleSuccess && (
                    <div data-testid="wvtr-title-success" className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800 font-medium">
                      ✓ Title released successfully.
                    </div>
                  )}

                  {/* Refusal banner — shown when server returns 409 TITLE_RELEASE_REFUSED_UNPAID */}
                  {titleRefused && (
                    <div data-testid="wvtr-title-refused" className="rounded-lg bg-red-50 border border-red-300 px-4 py-3 text-sm text-red-800">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                        <div>
                          <p className="font-semibold">Title Release Refused — Item Not Paid in Full</p>
                          {titleRefusalDetail && <p className="mt-1 text-red-700">{titleRefusalDetail}</p>}
                          <p className="mt-1 text-red-600 text-xs">Record additional payments or use the exception path below after obtaining required authorization.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Primary release button */}
                  <Btn
                    variant="primary"
                    size="lg"
                    loading={releaseTitleMut.isPending}
                    onClick={() => { setTitleRefused(false); setTitleSuccess(false); releaseTitleMut.mutate(); }}
                    data-testid="wvtr-release-title"
                  >
                    Release Title
                  </Btn>

                  {/* Exception path — visually and functionally distinct */}
                  <div className="mt-4 pt-4 border-t border-amber-200">
                    <div className="flex items-start gap-2 mb-2">
                      <ShieldAlert size={15} className="text-amber-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-700 font-medium">
                        Exception path — bypasses the paid-in-full gate. Requires separate authorization.
                      </p>
                    </div>
                    <Btn
                      variant="danger"
                      size="sm"
                      onClick={() => { setShowExceptionDialog(true); setExceptionError(null); setExceptionReason(''); }}
                      data-testid="wvtr-release-exception-open"
                    >
                      Release with Exception (Audited)
                    </Btn>
                  </div>
                </div>
              )}

              {/* Exception audit trail — always visible */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                  <ShieldAlert size={14} className="text-amber-500" />
                  Exception Audit Trail
                </h3>
                {(!exceptions || exceptions.length === 0) ? (
                  <p className="text-xs text-slate-400">No exception releases on record for this vehicle.</p>
                ) : (
                  <div className="space-y-2">
                    {exceptions.map((ex, i) => (
                      <div key={ex.id ?? i} className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
                        <p className="font-semibold text-amber-800">
                          Released via EXCEPTION by {ex.actor ?? ex.performedBy ?? 'unknown'} — reason: {ex.reason}
                        </p>
                        {ex.createdAt && (
                          <p className="text-amber-600 mt-0.5">on {new Date(ex.createdAt).toLocaleString()}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Exception confirmation dialog */}
      {showExceptionDialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl shadow-2xl w-[480px] p-6">
            <div className="flex items-start gap-3 mb-4">
              <ShieldAlert className="text-red-600 mt-0.5 shrink-0" size={22} />
              <div>
                <h3 className="text-base font-bold text-red-800">Release Title — Exception Path</h3>
                <p className="text-sm text-red-700 mt-1">
                  This bypasses the normal paid-in-full gate and will be <strong>permanently logged</strong> with
                  your identity and reason. This action requires a distinct authorization level and creates an
                  audited exception record visible to all users of this vehicle record.
                </p>
              </div>
            </div>
            {exceptionError && (
              <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">{exceptionError}</div>
            )}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Exception Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={4}
                data-testid="wvtr-exception-reason"
                className="w-full border border-red-300 rounded px-3 py-2 text-sm focus:ring-red-300 focus:outline-none focus:ring-2"
                placeholder="Provide a detailed justification for bypassing the paid-in-full requirement…"
                value={exceptionReason}
                onChange={e => setExceptionReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Btn
                variant="danger"
                loading={releaseTitleExceptionMut.isPending}
                disabled={!exceptionReason.trim()}
                onClick={() => { setExceptionError(null); releaseTitleExceptionMut.mutate(); }}
                data-testid="wvtr-exception-confirm"
              >
                Confirm Exception Release
              </Btn>
              <Btn variant="secondary" onClick={() => { setShowExceptionDialog(false); setExceptionReason(''); setExceptionError(null); }}>
                Cancel
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

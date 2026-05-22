import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, AlertTriangle, Clock, Calendar } from 'lucide-react';
import { serviceDayEndApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import StatusBadge from '../../components/StatusBadge';

// CF-001: Service Day-End Close (Service Program 6) is a SERVICE module program.
// It is entirely separate from the Accounting EOM Close (ACCT_xxx steps).
// When Service Day-End is closed, it publishes SERVICE_DAY_CLOSED to RabbitMQ.
// Accounting EOM subscribes to this event for EOM pre-requisite tracking.

interface DayEndReadiness {
  date: string;
  openRoCount: number;
  openCashierCount: number;
  cashReceiptsTotal: number;
  serviceRevenue: number;
  partsRevenue: number;
  allRosClosed: boolean;
  cashiersBalanced: boolean;
  canClose: boolean;
  lastClosedDate?: string;
  alreadyClosedToday: boolean;
}

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export default function DayEndClose() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  function showToast(message: string, type: 'success' | 'error') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }

  const { data: readiness, isLoading, error, refetch } = useQuery<DayEndReadiness>({
    queryKey: ['service-day-end-readiness'],
    queryFn: () => serviceDayEndApi.getReadiness(),
    refetchInterval: 30_000,
    retry: false,
  });

  const { data: history } = useQuery<any[]>({
    queryKey: ['service-day-end-history'],
    queryFn: () => serviceDayEndApi.getHistory('limit=10'),
    retry: false,
  });

  const closeMutation = useMutation({
    mutationFn: () => serviceDayEndApi.close(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-day-end-readiness'] });
      queryClient.invalidateQueries({ queryKey: ['service-day-end-history'] });
      setConfirmOpen(false);
      showToast('Service day closed — SERVICE_DAY_CLOSED event published to accounting', 'success');
    },
    onError: (e: any) => {
      showToast(e.message ?? 'Day-end close failed', 'error');
      setConfirmOpen(false);
    },
  });

  if (isLoading) return <PageLoader page="Service Day-End Close" />;
  if (error) return <PageError error={error} retry={() => refetch()} />;
  if (!readiness) return null;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Calendar className="w-6 h-6 text-brand" />
          <h1 className="text-3xl font-bold text-gray-900">Service Day-End Close</h1>
        </div>
        <p className="text-gray-600 text-sm">Service Program 6 — {today}</p>
        <p className="text-xs text-gray-400 mt-1">
          This is a Service module operation. It is separate from Accounting EOM Close.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 px-4 py-3 rounded-lg text-white z-50 shadow-lg ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Already closed banner */}
      {readiness.alreadyClosedToday && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-green-900">Day Already Closed</p>
            <p className="text-sm text-green-800">
              Service day-end close has already been completed for today.
              {readiness.lastClosedDate && ` Last closed: ${new Date(readiness.lastClosedDate).toLocaleString()}`}
            </p>
          </div>
        </div>
      )}

      {/* Pre-close Summary */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Open ROs</p>
          <p className={`text-2xl font-bold font-mono ${readiness.openRoCount > 0 ? 'text-amber-700' : 'text-green-700'}`}>
            {readiness.openRoCount}
          </p>
          <p className="text-xs text-gray-500 mt-1">{readiness.allRosClosed ? 'All closed' : 'Must be closed'}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Service Revenue</p>
          <p className="text-2xl font-bold font-mono text-gray-900">{fmt(readiness.serviceRevenue)}</p>
          <p className="text-xs text-gray-500 mt-1">Today's service ROs</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Parts Revenue</p>
          <p className="text-2xl font-bold font-mono text-gray-900">{fmt(readiness.partsRevenue)}</p>
          <p className="text-xs text-gray-500 mt-1">Today's parts sales</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Cash Receipts</p>
          <p className="text-2xl font-bold font-mono text-gray-900">{fmt(readiness.cashReceiptsTotal)}</p>
          <p className="text-xs text-gray-500 mt-1">Total collected today</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 uppercase font-semibold mb-1">Open Cashiers</p>
          <p className={`text-2xl font-bold font-mono ${readiness.openCashierCount > 0 ? 'text-amber-700' : 'text-green-700'}`}>
            {readiness.openCashierCount}
          </p>
          <p className="text-xs text-gray-500 mt-1">{readiness.cashiersBalanced ? 'All balanced' : 'Need to balance'}</p>
        </div>
      </div>

      {/* Pre-close Checklist */}
      <div className="mb-6 bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Pre-Close Checklist</h2>
        <div className="space-y-3">
          {[
            {
              label: 'All repair orders closed',
              ok: readiness.allRosClosed,
              note: readiness.openRoCount > 0 ? `${readiness.openRoCount} RO(s) still open` : undefined,
            },
            {
              label: 'All cashiers balanced',
              ok: readiness.cashiersBalanced,
              note: readiness.openCashierCount > 0 ? `${readiness.openCashierCount} cashier(s) not balanced` : undefined,
            },
          ].map((item, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${
              item.ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
            }`}>
              {item.ok
                ? <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                : <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              }
              <div>
                <p className={`font-medium text-sm ${item.ok ? 'text-green-900' : 'text-amber-900'}`}>{item.label}</p>
                {item.note && <p className="text-xs text-amber-700 mt-0.5">{item.note}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Close Action */}
      {!readiness.alreadyClosedToday && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-2">Close Day</h2>
          <p className="text-sm text-gray-600 mb-4">
            Closing the service day finalizes today's ROs and cash receipts.
            An accounting event (<code className="bg-gray-100 px-1 rounded text-xs">SERVICE_DAY_CLOSED</code>) is published to notify the accounting module.
          </p>

          {!readiness.canClose && (
            <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800">
                Day-end close is blocked until all open ROs are closed and all cashiers are balanced.
              </p>
            </div>
          )}

          {confirmOpen && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="font-semibold text-red-900 mb-2">Confirm Service Day-End Close?</p>
              <p className="text-sm text-red-800 mb-4">
                This will close all remaining open items for today's service operations. This cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded font-medium text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => closeMutation.mutate()}
                  disabled={closeMutation.isPending}
                  className="px-4 py-2 bg-red-600 text-white rounded font-medium text-sm hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {closeMutation.isPending ? <Clock className="w-4 h-4 animate-spin" /> : null}
                  {closeMutation.isPending ? 'Closing...' : 'Confirm Close Day'}
                </button>
              </div>
            </div>
          )}

          {!confirmOpen && (
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={!readiness.canClose}
              className="px-6 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
            >
              <AlertTriangle className="w-4 h-4" />
              Close Day
            </button>
          )}
        </div>
      )}

      {/* History */}
      {history && history.length > 0 && (
        <div className="mt-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Recent Day-End History</h2>
          <div className="space-y-2">
            {history.map((entry: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <span className="text-sm text-gray-700">{new Date(entry.closedAt).toLocaleDateString()}</span>
                <span className="text-sm text-gray-500">{entry.closedBy ?? '—'}</span>
                <StatusBadge status={entry.status ?? 'COMPLETED'} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

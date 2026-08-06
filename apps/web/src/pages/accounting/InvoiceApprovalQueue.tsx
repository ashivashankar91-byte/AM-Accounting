/**
 * AMACC-CH04 S041 — Invoice Approval Queue
 * Lists invoices pending approval, shows approve/reject/void actions.
 * Self-approval guard: disables Approve when current user is invoice submitter (UX only;
 * server enforces with 403 which is also handled gracefully).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Trash2, AlertCircle, ShieldOff, ChevronDown, ChevronUp } from 'lucide-react';
import { apInvoiceApi, invoiceApprovalApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import DataTable from '../../components/DataTable';
import { Badge } from '../../components/ui';

function getCurrentUserId(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('goldenpath.user') ?? 'null');
    return user?.id ?? user?.sub ?? null;
  } catch {
    return null;
  }
}

function statusVariant(status: string): 'warning' | 'success' | 'danger' | 'neutral' {
  if (status === 'PENDING_APPROVAL') return 'warning';
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  return 'neutral';
}

function ApprovalDetail({ invoice, onClose }: { invoice: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const currentUserId = getCurrentUserId();
  const isSelf = !!(currentUserId && (invoice.submittedBy === currentUserId || invoice.createdBy === currentUserId));

  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const { data: instance, isLoading: instanceLoading } = useQuery({
    queryKey: ['approval-instance', invoice.id],
    queryFn: () => invoiceApprovalApi.getInstance(invoice.id),
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
    queryClient.invalidateQueries({ queryKey: ['approval-instance', invoice.id] });
  };

  const approveMut = useMutation({
    mutationFn: () => invoiceApprovalApi.approve(invoice.id, { version: invoice.version }),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (err: any) => {
      if (err?.status === 403) {
        setInlineError('Unauthorized: ' + (err?.body?.message ?? 'You do not have permission to approve this invoice.'));
      } else {
        setInlineError(err?.body?.message ?? err.message ?? 'Approve failed');
      }
    },
  });

  const rejectMut = useMutation({
    mutationFn: () => invoiceApprovalApi.reject(invoice.id, { version: invoice.version, reason: rejectReason }),
    onSuccess: () => { invalidate(); setShowReject(false); onClose(); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Reject failed'),
  });

  const voidMut = useMutation({
    mutationFn: () => apInvoiceApi.void(invoice.id, { version: invoice.version, reason: voidReason }),
    onSuccess: () => { invalidate(); setShowVoid(false); onClose(); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Void failed'),
  });

  const pendingStep = (instance as any)?.steps?.find((s: any) => s.status === 'PENDING');
  const stepLabel = pendingStep ? `tier ${pendingStep.sequence}` : 'current tier';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[36rem] p-6 space-y-4 max-h-[80vh] overflow-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-lg" data-testid="approval-detail-modal">Invoice {invoice.invoiceNumber}</h3>
            <p className="text-sm text-gray-500">{invoice.vendorId} · ${Number(invoice.totalAmount ?? 0).toFixed(2)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {inlineError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{inlineError}</p>
          </div>
        )}

        {/* Approval instance detail */}
        {instanceLoading ? (
          <p className="text-sm text-gray-400">Loading approval workflow…</p>
        ) : instance ? (
          <div className="border rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold uppercase text-gray-500">Approval Workflow</p>
            <p className="text-sm">Status: <Badge variant={statusVariant((instance as any).status)}>{(instance as any).status}</Badge></p>
            {(instance as any).delegatedTo && (
              <p className="text-xs text-gray-500">Delegated to: {(instance as any).delegatedTo}</p>
            )}
            {(instance as any).escalatedAt && (
              <p className="text-xs text-amber-600">Escalated at: {new Date((instance as any).escalatedAt).toLocaleString()}</p>
            )}
            {((instance as any).steps ?? []).map((step: any) => (
              <div key={step.id} className="text-xs text-gray-600 flex gap-2">
                <span className="font-mono">T{step.sequence}</span>
                <span>{step.requiredRole}</span>
                <Badge variant={step.status === 'APPROVED' ? 'success' : step.status === 'REJECTED' ? 'danger' : 'warning'}>
                  {step.status}
                </Badge>
                {step.decidedBy && <span>by {step.decidedBy}</span>}
              </div>
            ))}
          </div>
        ) : null}

        {/* Self-approval warning */}
        {isSelf && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-center gap-2">
            <ShieldOff className="w-4 h-4 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-700">Self-approval not permitted — you submitted this invoice.</p>
          </div>
        )}

        {/* Actions */}
        {invoice.status === 'PENDING_APPROVAL' && !showReject && !showVoid && (
          <div className="flex gap-3">
            <button
              onClick={() => { setInlineError(null); approveMut.mutate(); }}
              disabled={approveMut.isPending || isSelf}
              title={isSelf ? 'Self-approval not permitted' : undefined}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40"
            >
              <CheckCircle className="w-4 h-4" />
              {approveMut.isPending ? 'Approving…' : `Approve (${stepLabel})`}
            </button>
            <button
              onClick={() => setShowReject(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
            >
              <XCircle className="w-4 h-4" /> Reject
            </button>
            <button
              onClick={() => setShowVoid(true)}
              className="flex items-center gap-1.5 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
            >
              <Trash2 className="w-4 h-4" /> Void
            </button>
          </div>
        )}

        {showReject && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Reject Reason *</label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={2}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Required"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setInlineError(null); rejectMut.mutate(); }}
                disabled={rejectMut.isPending || !rejectReason.trim()}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40"
              >
                {rejectMut.isPending ? 'Rejecting…' : 'Confirm Reject'}
              </button>
              <button onClick={() => setShowReject(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {showVoid && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Void Reason *</label>
            <textarea
              value={voidReason}
              onChange={e => setVoidReason(e.target.value)}
              rows={2}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="Required"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setInlineError(null); voidMut.mutate(); }}
                disabled={voidMut.isPending || !voidReason.trim()}
                className="px-4 py-2 bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-40"
              >
                {voidMut.isPending ? 'Voiding…' : 'Confirm Void'}
              </button>
              <button onClick={() => setShowVoid(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InvoiceApprovalQueue() {
  const [selected, setSelected] = useState<any | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['approval-queue'],
    queryFn: () => apInvoiceApi.list('status=PENDING_APPROVAL&pageSize=100'),
    retry: false,
  });

  const err = error as any;
  if (isLoading) return <PageLoader page="Invoice Approval Queue" service="apar-service" port={3013} />;
  if (isError) {
    if (err?.status === 401 || err?.status === 403) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <ShieldOff className="w-10 h-10 mx-auto mb-3 text-amber-400" />
            <p className="text-sm text-gray-600">You do not have permission to view the approval queue.</p>
          </div>
        </div>
      );
    }
    return <PageError error={error as Error} retry={refetch} serviceName="apar-service" port={3013} />;
  }

  const invoices: any[] = (data as any)?.items ?? [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Invoice Approval Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''} pending approval</p>
        </div>
      </div>

      <DataTable
        columns={[
          { key: 'invoiceNumber', label: 'Invoice #' },
          { key: 'vendorId', label: 'Vendor' },
          { key: 'invoiceDate', label: 'Invoice Date' },
          { key: 'dueDate', label: 'Due Date' },
          { key: 'totalAmount', label: 'Amount', align: 'right', render: (row) => `$${Number(row.totalAmount ?? 0).toFixed(2)}` },
          { key: 'status', label: 'Status', render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge> },
          { key: 'actions', label: '', render: (row) => (
            <button
              onClick={(e) => { e.stopPropagation(); setSelected(row); }}
              className="text-xs text-brand hover:underline font-medium"
            >
              Review
            </button>
          )},
        ]}
        data={invoices}
        rowTestIdPrefix="approval-invoice-row"
        onRowClick={(row) => setExpandedId(expandedId === row.id ? null : row.id)}
        emptyIcon="✅"
        emptyTitle="No invoices pending approval"
        emptySubtitle="All caught up — nothing in the approval queue."
      />

      {selected && <ApprovalDetail invoice={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

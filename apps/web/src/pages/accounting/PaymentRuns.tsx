/**
 * AMACC-CH04 S045 — Payment Runs
 * List, create, detail, approve/reject, execute (with confirmation), and rail artifact generation.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, AlertCircle, ShieldOff, Download } from 'lucide-react';
import { paymentRunApi, bankAccountApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import DataTable from '../../components/DataTable';
import { Badge, Btn } from '../../components/ui';

type RailMode = 'CHECK_PRINT' | 'POSITIVE_PAY' | 'ACH_NACHA';

function statusVariant(status: string): 'warning' | 'success' | 'danger' | 'neutral' | 'info' {
  if (status === 'APPROVED' || status === 'EXECUTED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING_APPROVAL') return 'warning';
  if (status === 'PROPOSED') return 'info';
  return 'neutral';
}

interface CreateRunForm {
  bankAccountId: string;
  dueDateThrough: string;
  discountDateThrough: string;
  vendorIds: string;
}

function CreateRunModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateRunForm>({
    bankAccountId: '',
    dueDateThrough: '',
    discountDateThrough: '',
    vendorIds: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: () => bankAccountApi.list(),
    retry: false,
  });

  const createMut = useMutation({
    mutationFn: () => paymentRunApi.create({
      bankAccountId: form.bankAccountId,
      dueDateThrough: form.dueDateThrough,
      discountDateThrough: form.discountDateThrough || undefined,
      vendorIds: form.vendorIds ? form.vendorIds.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: any) => setFormError(err?.body?.message ?? err.message ?? 'Failed to create payment run'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[32rem] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">New Payment Run Proposal</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        {formError && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">{formError}</div>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bank Account *</label>
            <select
              value={form.bankAccountId}
              onChange={e => setForm(f => ({ ...f, bankAccountId: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm"
              data-testid="payrun-bank-account"
            >
              <option value="">— select —</option>
              {(bankAccounts as any[]).map((ba: any) => (
                <option key={ba.id} value={ba.id}>{ba.bankName} …{ba.accountNumber?.slice(-4)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Due Date Through *</label>
            <input
              type="date"
              value={form.dueDateThrough}
              onChange={e => setForm(f => ({ ...f, dueDateThrough: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm"
              data-testid="payrun-due-date"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Discount Date Through</label>
            <input
              type="date"
              value={form.discountDateThrough}
              onChange={e => setForm(f => ({ ...f, discountDateThrough: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Vendor IDs (comma-separated, optional)</label>
            <input
              type="text"
              value={form.vendorIds}
              onChange={e => setForm(f => ({ ...f, vendorIds: e.target.value }))}
              className="w-full border rounded px-3 py-2 text-sm"
              placeholder="id1, id2"
            />
          </div>
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <Btn
            onClick={() => { setFormError(null); createMut.mutate(); }}
            disabled={createMut.isPending || !form.bankAccountId || !form.dueDateThrough}
            loading={createMut.isPending}
            data-testid="payrun-create-submit"
          >
            Create Proposal
          </Btn>
        </div>
      </div>
    </div>
  );
}

function RunDetail({ run, onClose }: { run: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [railMode, setRailMode] = useState<RailMode>('CHECK_PRINT');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['payment-run', run.id],
    queryFn: () => paymentRunApi.getById(run.id),
    retry: false,
  });

  const { data: artifacts = [], refetch: refetchArtifacts } = useQuery({
    queryKey: ['payment-run-artifacts', run.id],
    queryFn: () => paymentRunApi.getRailArtifacts(run.id),
    retry: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['payment-runs'] });
    queryClient.invalidateQueries({ queryKey: ['payment-run', run.id] });
  };

  const notify = (msg: string) => { setNotification(msg); setTimeout(() => setNotification(null), 3000); };

  const approveMut = useMutation({
    mutationFn: () => paymentRunApi.approve(run.id),
    onSuccess: () => { invalidate(); notify('Payment run approved.'); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Approve failed'),
  });

  const rejectMut = useMutation({
    mutationFn: () => paymentRunApi.reject(run.id, { reason: rejectReason }),
    onSuccess: () => { invalidate(); setShowReject(false); notify('Payment run rejected.'); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Reject failed'),
  });

  const executeMut = useMutation({
    mutationFn: () => paymentRunApi.execute(run.id),
    onSuccess: () => { invalidate(); setConfirmExecute(false); notify('Payment run executed.'); },
    onError: (err: any) => { setConfirmExecute(false); setInlineError(err?.body?.message ?? err.message ?? 'Execute failed'); },
  });

  const railMut = useMutation({
    mutationFn: () => paymentRunApi.generateRailArtifact(run.id, { mode: railMode }),
    onSuccess: () => { refetchArtifacts(); notify(`Rail artifact (${railMode}) generated.`); },
    onError: (err: any) => setInlineError(err?.body?.message ?? err.message ?? 'Rail artifact failed'),
  });

  const currentRun = (detail as any) ?? run;
  const lineItems: any[] = currentRun?.lineItems ?? currentRun?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[42rem] p-6 space-y-4 max-h-[90vh] overflow-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-lg">Payment Run</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {currentRun.id} · <Badge data-testid="payrun-status" variant={statusVariant(currentRun.status)}>{currentRun.status}</Badge>
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {notification && (
          <div className="bg-green-50 border border-green-200 rounded p-2 text-sm text-green-700">{notification}</div>
        )}
        {inlineError && (
          <div className="bg-red-50 border border-red-200 rounded p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{inlineError}</p>
          </div>
        )}

        {detailLoading && <p className="text-sm text-gray-400">Loading…</p>}

        {/* Run metadata */}
        <dl className="grid grid-cols-2 gap-2 text-sm border rounded-lg p-3">
          <div><dt className="text-xs text-gray-500">Bank Account</dt><dd>{currentRun.bankAccountId ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Due Date Through</dt><dd>{currentRun.dueDateThrough ?? '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Total Amount</dt><dd data-testid="payrun-total-amount">{currentRun.totalAmount != null ? `$${Number(currentRun.totalAmount).toFixed(2)}` : '—'}</dd></div>
          <div><dt className="text-xs text-gray-500">Created</dt><dd>{currentRun.createdAt ? new Date(currentRun.createdAt).toLocaleDateString() : '—'}</dd></div>
        </dl>

        {/* Line items */}
        {lineItems.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Line Items ({lineItems.length})</p>
            <div className="border rounded overflow-auto max-h-40">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">Vendor</th>
                    <th className="px-3 py-2 text-left">Invoice</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((li: any, i: number) => (
                    <tr key={li.id ?? i} className="border-t">
                      <td className="px-3 py-1.5">{li.vendorId ?? li.vendorName ?? '—'}</td>
                      <td className="px-3 py-1.5 font-mono">{li.invoiceId ?? li.invoiceNumber ?? '—'}</td>
                      <td className="px-3 py-1.5 text-right">{li.amount != null ? `$${Number(li.amount).toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Actions */}
        {!showReject && !confirmExecute && (
          <div className="flex flex-wrap gap-2">
            {currentRun.status === 'PROPOSED' && (
              <button
                onClick={() => { setInlineError(null); approveMut.mutate(); }}
                disabled={approveMut.isPending}
                data-testid="payrun-approve"
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40"
              >
                {approveMut.isPending ? 'Approving…' : 'Approve'}
              </button>
            )}
            {(currentRun.status === 'PROPOSED' || currentRun.status === 'PENDING_APPROVAL') && (
              <button
                onClick={() => setShowReject(true)}
                data-testid="payrun-reject-open"
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
              >
                Reject
              </button>
            )}
            {currentRun.status === 'APPROVED' && (
              <button
                onClick={() => setConfirmExecute(true)}
                data-testid="payrun-execute-open"
                className="flex items-center gap-1.5 px-4 py-2 bg-brand text-white rounded-lg text-sm font-medium hover:bg-brand-hover"
              >
                Execute Run
              </button>
            )}
          </div>
        )}

        {showReject && (
          <div className="space-y-2 border rounded-lg p-3">
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
                data-testid="payrun-reject-confirm"
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium disabled:opacity-40"
              >
                {rejectMut.isPending ? 'Rejecting…' : 'Confirm Reject'}
              </button>
              <button onClick={() => setShowReject(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {/* Execute confirmation dialog — irreversible action ceremony */}
        {confirmExecute && (
          <div className="border-2 border-amber-300 rounded-lg p-4 space-y-3 bg-amber-50">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">Confirm Execute Payment Run</p>
                <p className="text-sm text-amber-700 mt-1">
                  This will generate and post all payments in this run. <strong>This action is irreversible.</strong>
                  Once executed, payments cannot be recalled from this screen.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { setInlineError(null); executeMut.mutate(); }}
                disabled={executeMut.isPending}
                data-testid="payrun-execute-confirm"
                className="px-4 py-2 bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-amber-800"
              >
                {executeMut.isPending ? 'Executing…' : 'Yes, Execute Now'}
              </button>
              <button onClick={() => setConfirmExecute(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        )}

        {/* Rail Artifact Generation */}
        {(currentRun.status === 'APPROVED' || currentRun.status === 'EXECUTED') && (
          <div className="border rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase">Generate Rail Artifact</p>
            <div className="flex gap-2 items-center">
              <select
                value={railMode}
                onChange={e => setRailMode(e.target.value as RailMode)}
                className="border rounded px-3 py-1.5 text-sm"
                data-testid="payrun-rail-mode"
              >
                <option value="CHECK_PRINT">Check Print</option>
                <option value="POSITIVE_PAY">Positive Pay</option>
                <option value="ACH_NACHA">ACH / NACHA</option>
              </select>
              <Btn onClick={() => { setInlineError(null); railMut.mutate(); }} loading={railMut.isPending} size="sm" data-testid="payrun-generate-rail">
                Generate
              </Btn>
            </div>
          </div>
        )}

        {/* Rail Artifacts list */}
        {(artifacts as any[]).length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Generated Artifacts</p>
            <div className="border rounded overflow-auto max-h-32">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Mode</th>
                    <th className="px-3 py-2 text-left">Created</th>
                    <th className="px-3 py-2 text-left">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {(artifacts as any[]).map((art: any, i: number) => (
                    <tr key={art.id ?? i} className="border-t">
                      <td className="px-3 py-1.5 font-mono">{art.id ?? '—'}</td>
                      <td className="px-3 py-1.5">{art.mode ?? art.artifactType ?? '—'}</td>
                      <td className="px-3 py-1.5">{art.createdAt ? new Date(art.createdAt).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-1.5">
                        {(art.url || art.downloadUrl || art.contentUrl) ? (
                          <a href={art.url ?? art.downloadUrl ?? art.contentUrl} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline flex items-center gap-1">
                            <Download className="w-3 h-3" /> Download
                          </a>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PaymentRuns() {
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['payment-runs'],
    queryFn: () => paymentRunApi.list(),
    retry: false,
  });

  const err = error as any;

  if (isLoading) return <PageLoader page="Payment Runs" service="apar-service" port={3013} />;
  if (isError) {
    if (err?.status === 401 || err?.status === 403) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <ShieldOff className="w-10 h-10 mx-auto mb-3 text-amber-400" />
            <p className="text-sm text-gray-600">You do not have permission to view payment runs.</p>
          </div>
        </div>
      );
    }
    return <PageError error={error as Error} retry={refetch} serviceName="apar-service" port={3013} />;
  }

  const runs: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Payment Runs</h1>
          <p className="text-sm text-gray-500 mt-0.5">{runs.length} run{runs.length !== 1 ? 's' : ''}</p>
        </div>
        <Btn onClick={() => setShowCreate(true)} icon={<Plus className="w-4 h-4" />} data-testid="payrun-new-open">
          New Run Proposal
        </Btn>
      </div>

      <DataTable
        columns={[
          { key: 'id', label: 'Run ID', mono: true },
          { key: 'bankAccountId', label: 'Bank Account' },
          { key: 'dueDateThrough', label: 'Due Date Through' },
          { key: 'totalAmount', label: 'Total Amount', align: 'right', render: (row) => row.totalAmount != null ? `$${Number(row.totalAmount).toFixed(2)}` : '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge> },
          { key: 'createdAt', label: 'Created', render: (row) => row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—' },
          { key: 'actions', label: '', render: (row) => (
            <button
              onClick={(e) => { e.stopPropagation(); setSelectedRun(row); }}
              className="text-xs text-brand hover:underline font-medium"
            >
              Open
            </button>
          )},
        ]}
        data={runs}
        onRowClick={(row) => setSelectedRun(row)}
        keyField="id"
        rowTestIdPrefix="payrun-row"
        emptyIcon="💳"
        emptyTitle="No payment runs yet"
        emptySubtitle="Create a proposal to begin a payment run."
      />

      {showCreate && (
        <CreateRunModal
          onClose={() => setShowCreate(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ['payment-runs'] })}
        />
      )}
      {selectedRun && <RunDetail run={selectedRun} onClose={() => setSelectedRun(null)} />}
    </div>
  );
}

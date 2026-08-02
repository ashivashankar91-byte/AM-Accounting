/**
 * AMACC S050/S051 — Write-offs & Allowance Previews
 * (a) Write-offs: register, list, create, reverse
 * (b) Allowance Previews: list, compute (preview only), approve (explicit step), post
 *
 * CRITICAL: computePreview NEVER posts. approvePreview is a DISTINCT human step.
 * post() MUST send the exact approved amount — server returns ALLOWANCE_POST_AMOUNT_MISMATCH
 * if it differs. Never auto-post on compute or approve.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, FileX, AlertTriangle, CheckCircle } from 'lucide-react';
import { writeOffApi, allowancePreviewApi } from '../../api/client';
import PageLoader from '../../components/PageLoader';
import PageError from '../../components/PageError';
import {
  Btn, Badge, PageHeader, MoneyCell, EmptyState,
} from '../../components/ui';
import DataTable, { Column } from '../../components/DataTable';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WriteOff {
  id: string;
  arEntryId: string;
  amount: number | string;
  reason: string;
  useOverride?: boolean;
  status?: string;
  reversedAt?: string;
  createdAt?: string;
}

interface RegisterEntry {
  id: string;
  arEntryId?: string;
  amount?: number | string;
  reason?: string;
  period?: string;
  createdAt?: string;
}

interface AllowancePreview {
  id: string;
  asOfDate: string;
  previewAmount?: number | string;
  approvedAmount?: number | string;
  status?: 'DRAFT' | 'APPROVED' | 'POSTED';
  approvedBy?: string;
  approvedAt?: string;
  postedAt?: string;
  createdAt?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

type ActiveTab = 'writeoffs' | 'allowances';

export default function WriteOffsAndAllowances() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ActiveTab>('writeoffs');

  // Write-offs state
  const [registerPeriod, setRegisterPeriod] = useState('');
  const [submittedRegisterPeriod, setSubmittedRegisterPeriod] = useState<string | undefined>(undefined);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ arEntryId: '', amount: '', reason: '', useOverride: false });
  const [createError, setCreateError] = useState<string | null>(null);
  const [reverseTarget, setReverseTarget] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState<string | null>(null);

  // Allowance preview state
  const [asOfDate, setAsOfDate] = useState('');
  const [computedPreview, setComputedPreview] = useState<AllowancePreview | null>(null);
  const [computeError, setComputeError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState<string | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────

  const {
    data: writeOffs,
    isLoading: woLoading,
    isError: woError,
    error: woErrorObj,
    refetch: refetchWO,
  } = useQuery<WriteOff[]>({
    queryKey: ['write-offs-list'],
    queryFn: () => writeOffApi.list(),
    enabled: activeTab === 'writeoffs',
    retry: false,
  });

  const {
    data: register,
    isLoading: registerLoading,
    isError: registerError,
    error: registerErrorObj,
    refetch: refetchRegister,
  } = useQuery<RegisterEntry[]>({
    queryKey: ['write-offs-register', submittedRegisterPeriod],
    queryFn: () => writeOffApi.getRegister(submittedRegisterPeriod ? `period=${submittedRegisterPeriod}` : undefined),
    enabled: activeTab === 'writeoffs' && submittedRegisterPeriod !== undefined,
    retry: false,
  });

  const {
    data: previews,
    isLoading: previewsLoading,
    isError: previewsError,
    error: previewsErrorObj,
    refetch: refetchPreviews,
  } = useQuery<AllowancePreview[]>({
    queryKey: ['allowance-previews-list'],
    queryFn: () => allowancePreviewApi.list(),
    enabled: activeTab === 'allowances',
    retry: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createWOMut = useMutation({
    mutationFn: () =>
      writeOffApi.create({
        arEntryId: createForm.arEntryId,
        amount: parseFloat(createForm.amount),
        reason: createForm.reason,
        useOverride: createForm.useOverride || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['write-offs-list'] });
      setShowCreateForm(false);
      setCreateForm({ arEntryId: '', amount: '', reason: '', useOverride: false });
      setCreateError(null);
    },
    onError: (err: any) => setCreateError(err?.body?.message || err.message || 'Create failed'),
  });

  const reverseMut = useMutation({
    mutationFn: () => writeOffApi.reverse(reverseTarget!, { reason: reverseReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['write-offs-list'] });
      setReverseTarget(null);
      setReverseReason('');
      setReverseError(null);
    },
    onError: (err: any) => setReverseError(err?.body?.message || err.message || 'Reverse failed'),
  });

  const computeMut = useMutation({
    mutationFn: () => allowancePreviewApi.computePreview({ asOfDate }),
    onSuccess: (res: any) => {
      setComputedPreview(res);
      setComputeError(null);
      queryClient.invalidateQueries({ queryKey: ['allowance-previews-list'] });
    },
    onError: (err: any) => {
      setComputeError(err?.body?.message || err.message || 'Compute failed');
      setComputedPreview(null);
    },
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => allowancePreviewApi.approvePreview(id),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['allowance-previews-list'] });
      setComputedPreview(res);
      setApproveSuccess('Preview approved. You may now post the approved amount.');
      setPostError(null);
    },
    onError: (err: any) => {
      setApproveSuccess(null);
      setPostError(err?.body?.message || err.message || 'Approve failed');
    },
  });

  const postMut = useMutation({
    mutationFn: (preview: AllowancePreview) =>
      // postedAmount MUST equal approvedAmount — server refuses ALLOWANCE_POST_AMOUNT_MISMATCH otherwise
      allowancePreviewApi.post(preview.id, { postedAmount: Number(preview.approvedAmount ?? preview.previewAmount) }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['allowance-previews-list'] });
      setComputedPreview(res);
      setPostSuccess('Allowance posted successfully.');
      setPostError(null);
    },
    onError: (err: any) => {
      const msg = err?.body?.message || err.message || 'Post failed';
      // Surface server error verbatim — never silently retry with a different amount
      setPostError(msg);
    },
  });

  const isUnauthorized =
    (woErrorObj as any)?.status === 401 || (woErrorObj as any)?.status === 403 ||
    (previewsErrorObj as any)?.status === 401 || (previewsErrorObj as any)?.status === 403;

  const woColumns: Column<WriteOff>[] = [
    { key: 'arEntryId', label: 'AR Entry', mono: true },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <MoneyCell value={r.amount} /> },
    { key: 'reason', label: 'Reason' },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Badge variant={r.status === 'REVERSED' ? 'warning' : r.status === 'ACTIVE' ? 'success' : 'neutral'}>
          {r.status ?? 'ACTIVE'}
        </Badge>
      ),
    },
    { key: 'createdAt', label: 'Created', render: (r) => r.createdAt?.slice(0, 10) ?? '—' },
    {
      key: 'actions',
      label: '',
      render: (r) => r.status !== 'REVERSED' ? (
        <Btn size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setReverseTarget(r.id); setReverseReason(''); setReverseError(null); }} data-testid={`wo-reverse-open-${r.id}`}>
          Reverse
        </Btn>
      ) : null,
    },
  ];

  const previewColumns: Column<AllowancePreview>[] = [
    { key: 'asOfDate', label: 'As Of', render: (r) => r.asOfDate?.slice(0, 10) ?? '—' },
    { key: 'previewAmount', label: 'Preview Amount', align: 'right', render: (r) => <MoneyCell value={r.previewAmount ?? 0} /> },
    { key: 'approvedAmount', label: 'Approved Amount', align: 'right', render: (r) => r.approvedAmount != null ? <MoneyCell value={r.approvedAmount} /> : <span className="text-slate-400">—</span> },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Badge variant={r.status === 'POSTED' ? 'success' : r.status === 'APPROVED' ? 'info' : 'neutral'}>
          {r.status ?? 'DRAFT'}
        </Badge>
      ),
    },
    { key: 'createdAt', label: 'Created', render: (r) => r.createdAt?.slice(0, 10) ?? '—' },
  ];

  return (
    <div className="p-6">
      <PageHeader
        title="Write-offs & Allowance Previews"
        subtitle="Manage direct write-offs, reversals, and allowance preview workflow"
      />

      {isUnauthorized && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          You do not have permission to manage write-offs or allowance previews.
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {(['writeoffs', 'allowances'] as ActiveTab[]).map((t) => (
          <button
            key={t}
            data-testid={`wo-tab-${t}`}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${activeTab === t ? 'text-brand border-b-2 border-brand bg-brand-light' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t === 'writeoffs' ? 'Write-offs' : 'Allowance Previews'}
          </button>
        ))}
      </div>

      {/* ── WRITE-OFFS TAB ── */}
      {activeTab === 'writeoffs' && (
        <div className="space-y-6">
          {/* Register section */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Write-off Register</h3>
            <div className="flex gap-3 items-end mb-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Period (YYYY-MM, optional)</label>
                <input
                  className="border rounded px-3 py-2 text-sm font-mono w-36"
                  placeholder="2026-07"
                  value={registerPeriod}
                  onChange={e => setRegisterPeriod(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') setSubmittedRegisterPeriod(registerPeriod || undefined); }}
                />
              </div>
              <Btn variant="secondary" onClick={() => setSubmittedRegisterPeriod(registerPeriod || undefined)}>Load Register</Btn>
              <Btn variant="ghost" size="sm" onClick={() => { setRegisterPeriod(''); setSubmittedRegisterPeriod(undefined); }}>Clear</Btn>
            </div>

            {registerLoading && <PageLoader page="register" />}
            {registerError && <PageError error={registerErrorObj as Error} retry={refetchRegister} />}
            {!registerLoading && register && (
              register.length === 0 ? (
                <p className="text-xs text-slate-400 py-3">No register entries for this period.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-slate-500"><th className="py-1 text-left">AR Entry</th><th className="py-1 text-left">Period</th><th className="py-1 text-left">Reason</th><th className="py-1 text-right">Amount</th></tr></thead>
                  <tbody>
                    {register.map((r, i) => (
                      <tr key={r.id ?? i} className="border-b border-slate-50">
                        <td className="py-1.5 font-mono">{r.arEntryId ?? '—'}</td>
                        <td className="py-1.5">{r.period ?? '—'}</td>
                        <td className="py-1.5 text-slate-600">{r.reason ?? '—'}</td>
                        <td className="py-1.5 text-right font-mono"><MoneyCell value={r.amount ?? 0} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
            {submittedRegisterPeriod === undefined && !registerLoading && (
              <p className="text-xs text-slate-400">Click "Load Register" to view entries (optionally filter by period).</p>
            )}
          </div>

          {/* Write-off list + create */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">All Write-offs</h3>
              <Btn icon={<Plus size={14} />} onClick={() => { setShowCreateForm(p => !p); setCreateError(null); }} data-testid="wo-new-open">New Write-off</Btn>
            </div>

            {showCreateForm && (
              <form
                onSubmit={(e) => { e.preventDefault(); setCreateError(null); createWOMut.mutate(); }}
                className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 mb-4"
              >
                {createError && <div data-testid="wo-create-error" className="text-sm text-red-600">{createError}</div>}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">AR Entry ID <span className="text-red-500">*</span></label>
                    <input data-testid="wo-ar-entry-id" className="w-full border rounded px-3 py-2 text-sm font-mono" value={createForm.arEntryId} onChange={e => setCreateForm(p => ({ ...p, arEntryId: e.target.value }))} required />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Amount <span className="text-red-500">*</span></label>
                    <input data-testid="wo-amount" type="number" step="0.01" min="0.01" className="w-full border rounded px-3 py-2 text-sm font-mono" value={createForm.amount} onChange={e => setCreateForm(p => ({ ...p, amount: e.target.value }))} required />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Reason <span className="text-red-500">*</span></label>
                    <input data-testid="wo-reason" className="w-full border rounded px-3 py-2 text-sm" value={createForm.reason} onChange={e => setCreateForm(p => ({ ...p, reason: e.target.value }))} required />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input data-testid="wo-use-override" type="checkbox" id="useOverride" checked={createForm.useOverride} onChange={e => setCreateForm(p => ({ ...p, useOverride: e.target.checked }))} className="rounded" />
                  <label htmlFor="useOverride" className="text-xs text-slate-600">Use override (requires authorization)</label>
                </div>
                <div className="flex gap-2">
                  <Btn type="submit" size="sm" loading={createWOMut.isPending} data-testid="wo-create-submit">Create Write-off</Btn>
                  <Btn variant="secondary" size="sm" type="button" onClick={() => { setShowCreateForm(false); setCreateError(null); }}>Cancel</Btn>
                </div>
              </form>
            )}

            {woLoading && <PageLoader page="write-offs" service="apar-service" />}
            {woError && !isUnauthorized && <PageError error={woErrorObj as Error} retry={refetchWO} />}
            {!woLoading && !woError && writeOffs && (
              writeOffs.length === 0 ? (
                <EmptyState icon={<FileX size={20} />} title="No write-offs" description="Create the first direct write-off." />
              ) : (
                <DataTable columns={woColumns} data={writeOffs} rowTestIdPrefix="wo-row" />
              )
            )}
          </div>

          {/* Reverse dialog */}
          {reverseTarget && (
            <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
              <div className="bg-white rounded-2xl shadow-2xl w-[420px] p-6 space-y-4">
                <h3 className="text-base font-bold text-slate-900">Reverse Write-off</h3>
                {reverseError && <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{reverseError}</div>}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Reversal Reason <span className="text-red-500">*</span></label>
                  <textarea rows={3} className="w-full border rounded px-3 py-2 text-sm" placeholder="Reason for reversing this write-off…" value={reverseReason} onChange={e => setReverseReason(e.target.value)} />
                </div>
                <div className="flex gap-3">
                  <Btn variant="danger" disabled={!reverseReason.trim()} loading={reverseMut.isPending} onClick={() => reverseMut.mutate()} data-testid="wo-reverse-confirm">Confirm Reversal</Btn>
                  <Btn variant="secondary" onClick={() => { setReverseTarget(null); setReverseReason(''); setReverseError(null); }}>Cancel</Btn>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ALLOWANCES TAB ── */}
      {activeTab === 'allowances' && (
        <div className="space-y-6">
          {/* Compute preview form */}
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-1">Compute Allowance Preview</h3>
            <p className="text-xs text-slate-500 mb-4">
              Calculates an allowance estimate. <strong>Preview only — not posted.</strong> Approving and posting are separate explicit steps.
            </p>
            {computeError && <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-3">{computeError}</div>}

            <div className="flex gap-3 items-end mb-4">
              <div>
                <label htmlFor="asOfDate" className="block text-xs font-medium text-slate-600 mb-1">As Of Date <span className="text-red-500">*</span></label>
                <input id="asOfDate" data-testid="allowance-as-of-date" type="date" className="border rounded px-3 py-2 text-sm" value={asOfDate} onChange={e => setAsOfDate(e.target.value)} />
              </div>
              <Btn onClick={() => { setComputeError(null); setComputedPreview(null); setPostSuccess(null); setPostError(null); setApproveSuccess(null); computeMut.mutate(); }} loading={computeMut.isPending} disabled={!asOfDate} data-testid="allowance-compute">
                Compute Preview
              </Btn>
            </div>

            {computedPreview && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-blue-800 uppercase tracking-wide">Preview Only — Not Posted</span>
                  <Badge variant={computedPreview.status === 'POSTED' ? 'success' : computedPreview.status === 'APPROVED' ? 'info' : 'neutral'}>
                    {computedPreview.status ?? 'DRAFT'}
                  </Badge>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-blue-600">As Of</dt><dd className="font-mono">{computedPreview.asOfDate?.slice(0, 10)}</dd></div>
                  <div><dt className="text-xs text-blue-600">Preview Amount</dt><dd className="font-mono font-bold text-blue-900" data-testid="allowance-preview-amount"><MoneyCell value={computedPreview.previewAmount ?? 0} /></dd></div>
                  {computedPreview.approvedAmount != null && (
                    <div><dt className="text-xs text-blue-600">Approved Amount</dt><dd className="font-mono font-bold text-emerald-700"><MoneyCell value={computedPreview.approvedAmount} /></dd></div>
                  )}
                </dl>

                {/* Approval messages */}
                {approveSuccess && (
                  <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700 flex items-center gap-2">
                    <CheckCircle size={14} /> {approveSuccess}
                  </div>
                )}
                {postSuccess && (
                  <div className="rounded bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-700 flex items-center gap-2">
                    <CheckCircle size={14} /> {postSuccess}
                  </div>
                )}
                {postError && (
                  <div data-testid="allowance-post-error" className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{postError}</div>
                )}

                {/* Action buttons — explicit separate steps */}
                <div className="flex gap-3 flex-wrap">
                  {/* Approve Preview — distinct from both compute and post */}
                  {computedPreview.status !== 'APPROVED' && computedPreview.status !== 'POSTED' && (
                    <Btn
                      variant="secondary"
                      size="sm"
                      loading={approveMut.isPending}
                      onClick={() => { setApproveSuccess(null); setPostError(null); approveMut.mutate(computedPreview.id); }}
                      data-testid="allowance-approve"
                    >
                      Approve Preview
                    </Btn>
                  )}

                  {/* Post — only available after approval, pre-fills approved amount, never auto-fires */}
                  {computedPreview.status === 'APPROVED' && computedPreview.approvedAmount != null && (
                    <Btn
                      variant="primary"
                      size="sm"
                      loading={postMut.isPending}
                      onClick={() => { setPostSuccess(null); setPostError(null); postMut.mutate(computedPreview); }}
                      data-testid="allowance-post"
                    >
                      Post ${Number(computedPreview.approvedAmount).toFixed(2)}
                    </Btn>
                  )}
                </div>
                {computedPreview.status !== 'APPROVED' && computedPreview.status !== 'POSTED' && (
                  <p className="text-xs text-slate-500">
                    You must explicitly approve the preview before the Post button becomes available. Posting sends exactly the approved amount.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Allowance preview list */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">All Allowance Previews</h3>
            {previewsLoading && <PageLoader page="allowance previews" service="apar-service" />}
            {previewsError && !isUnauthorized && <PageError error={previewsErrorObj as Error} retry={refetchPreviews} />}
            {!previewsLoading && !previewsError && previews && (
              previews.length === 0 ? (
                <EmptyState icon={<AlertTriangle size={20} />} title="No allowance previews" description="Compute the first allowance preview above." />
              ) : (
                <DataTable columns={previewColumns} data={previews} rowTestIdPrefix="allowance-row" />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

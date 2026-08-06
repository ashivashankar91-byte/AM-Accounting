// CE-12 / S085 — Biller Review Workbench. Queue of PENDING_REVIEW/HELD
// deals, a recap-vs-journal-blueprint preview (deal-accounting-service's
// own wrapper of coa-service's real posting-engine simulate() call — never
// estimated client-side), and the Hold/Release/Return-to-desking
// ceremonies. SoD: release is refused when the releasing actor is the same
// identity that finalized the deal (BILLER_SOD_VIOLATION) — surfaced
// verbatim, not as a generic error. After release, the resulting posted
// journal (postResult.outcomes) replaces the preview — it is never
// re-shown as if it were still a preview.
//
// Gap-closure pass: GET /review/queue now joins dealNumber/dealType/vin/
// stockNumber server-side, so the DealReviewCase row itself carries what
// this page needs for display and for driving the dealNumber-keyed
// preview/hold/release/return calls — the prior local GET /deals
// cross-reference-by-id workaround has been removed.
//
// Gap-closure pass — Due Bills: this page also hosts the due-bill/we-owe
// ceremony (S090-adjacent, no dedicated screen — see api/ce12-deal-client.ts
// due-bill methods) as a second top-level tab, since the biller is the
// operator who records/fulfills these obligations at delivery.
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertCircle, Search, ShieldAlert, Plus } from 'lucide-react';
import { ce12DealApi, type DealReviewCase, type DueBill, type PreviewSegment, type SegmentOutcome } from '../../../api/ce12-deal-client';

const fmtNum = (n: number) => (n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CASE_STATUS_BADGE: Record<string, string> = {
  PENDING_REVIEW: 'bg-amber-100 text-amber-700',
  HELD: 'bg-red-100 text-red-700',
  RELEASED: 'bg-emerald-100 text-emerald-700',
  RETURNED: 'bg-gray-100 text-gray-600',
};

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function BlueprintLinesTable({ segment }: { segment: PreviewSegment }) {
  if (segment.status === 'NO_RULE_MATCH' || segment.status === 'REJECTED') {
    return (
      <div className="text-[11px] text-red-600 flex items-center gap-1 py-1">
        <AlertCircle size={12} /> {segment.status}{segment.failureReason ? `: ${segment.failureReason}` : ''}
      </div>
    );
  }
  const lines = segment.lines ?? [];
  if (lines.length === 0) return <div className="text-[11px] text-gray-400 py-1">No blueprint lines returned.</div>;
  return (
    <table className="w-full text-[11px] border-collapse mt-1">
      <thead>
        <tr className="text-gray-500 text-left">
          <th className="pr-2 py-0.5 font-medium">Account</th>
          <th className="pr-2 py-0.5 font-medium">Store</th>
          <th className="pr-2 py-0.5 font-medium">Dept</th>
          <th className="pr-2 py-0.5 font-medium text-right">DR</th>
          <th className="pr-2 py-0.5 font-medium text-right">CR</th>
          <th className="pr-2 py-0.5 font-medium">Memo</th>
          <th className="pr-2 py-0.5 font-medium">Control#</th>
          <th className="pr-2 py-0.5 font-medium">Apply#</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i} className="border-t border-gray-100">
            <td className="pr-2 py-0.5 font-mono">{l.accountNumber}</td>
            <td className="pr-2 py-0.5 font-mono">{l.storeId}</td>
            <td className="pr-2 py-0.5">{l.deptCode ?? '—'}</td>
            <td className="pr-2 py-0.5 font-mono text-right">{l.dr ? fmtNum(l.dr) : ''}</td>
            <td className="pr-2 py-0.5 font-mono text-right">{l.cr ? fmtNum(l.cr) : ''}</td>
            <td className="pr-2 py-0.5">{l.memo ?? '—'}</td>
            <td className="pr-2 py-0.5 font-mono">{l.controlNumber ?? '—'}</td>
            <td className="pr-2 py-0.5 font-mono">{l.applyNumber ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReasonModal({
  title, submitLabel, testIdPrefix, busy, error, onSubmit, onClose,
}: {
  title: string; submitLabel: string; testIdPrefix: string; busy: boolean; error: string | null;
  onSubmit: (reason: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">{title}</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Reason (required)</label>
            <input
              autoFocus
              data-testid={`${testIdPrefix}-reason-input`}
              className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 focus:outline-none focus:ring-1 focus:ring-brand"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && (
            <div className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
          <button
            data-testid={`${testIdPrefix}-submit-button`}
            className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
            disabled={!reason.trim() || busy}
            onClick={() => onSubmit(reason.trim())}
          >
            {busy ? 'Submitting…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReleasedOutcomeTable({ outcomes }: { outcomes: SegmentOutcome[] }) {
  return (
    <table className="w-full text-[11px] border-collapse mt-1">
      <thead>
        <tr className="text-gray-500 text-left">
          <th className="pr-2 py-0.5 font-medium">Segment</th>
          <th className="pr-2 py-0.5 font-medium">Journal#</th>
          <th className="pr-2 py-0.5 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {outcomes.map((o) => (
          <tr key={o.eventId} data-testid={`released-segment-row-${o.tag}`} className="border-t border-gray-100">
            <td className="pr-2 py-0.5">{o.tag}</td>
            <td className="pr-2 py-0.5 font-mono">{o.journalNumber ?? '—'}</td>
            <td className="pr-2 py-0.5">
              <StatusBadge status={o.coaStatus} map={{ POSTED: 'bg-emerald-100 text-emerald-700', NO_RULE_MATCH: 'bg-amber-100 text-amber-700', REJECTED: 'bg-red-100 text-red-700', FAILED: 'bg-red-100 text-red-700' }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReviewQueuePanel() {
  const [statusFilter, setStatusFilter] = useState<'PENDING_REVIEW' | 'HELD' | ''>('PENDING_REVIEW');
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [holdOpen, setHoldOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releasedOutcomes, setReleasedOutcomes] = useState<SegmentOutcome[] | null>(null);
  const qc = useQueryClient();

  const { data: queueData, isLoading: queueLoading, error: queueError } = useQuery({
    queryKey: ['ce12-review-queue', statusFilter],
    queryFn: () => ce12DealApi.getReviewQueue(statusFilter || undefined),
  });

  const cases: DealReviewCase[] = queueData?.items ?? [];
  const selectedCase = cases.find((c) => c.id === selectedCaseId) ?? null;

  const { data: preview, isLoading: previewLoading, error: previewError, refetch: refetchPreview } = useQuery({
    queryKey: ['ce12-preview', selectedCase?.dealNumber, selectedCase?.recapVersion],
    queryFn: () => ce12DealApi.getPreview(selectedCase!.dealNumber!, selectedCase!.recapVersion),
    enabled: !!selectedCase?.dealNumber,
  });

  function selectCase(c: DealReviewCase) {
    setSelectedCaseId(c.id);
    setReleasedOutcomes(null);
    setReleaseError(null);
  }

  const holdMutation = useMutation({
    mutationFn: (reason: string) => ce12DealApi.holdReview(selectedCase!.dealNumber!, selectedCase!.recapVersion, reason),
    onSuccess: () => {
      setHoldOpen(false);
      qc.invalidateQueries({ queryKey: ['ce12-review-queue'] });
    },
  });

  const returnMutation = useMutation({
    mutationFn: (reason: string) => ce12DealApi.returnReview(selectedCase!.dealNumber!, selectedCase!.recapVersion, reason),
    onSuccess: () => {
      setReturnOpen(false);
      setSelectedCaseId(null);
      qc.invalidateQueries({ queryKey: ['ce12-review-queue'] });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: () => ce12DealApi.releaseReview(selectedCase!.dealNumber!, selectedCase!.recapVersion),
    onSuccess: (result) => {
      setReleaseError(null);
      setReleasedOutcomes(result.postResult.outcomes);
      qc.invalidateQueries({ queryKey: ['ce12-review-queue'] });
    },
    onError: (err: any) => {
      if (err?.body?.error === 'BILLER_SOD_VIOLATION') {
        setReleaseError(`Segregation-of-duties refusal: ${err.message}`);
      } else {
        setReleaseError(err?.message ?? 'Failed to release.');
      }
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 pt-2 pb-2">
        <div className="flex gap-4">
          {(['PENDING_REVIEW', 'HELD', ''] as const).map((s) => (
            <button
              key={s || 'all'}
              data-testid={`queue-filter-${s || 'all'}`}
              className={`pb-2 text-xs font-medium border-b-2 ${statusFilter === s ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
              onClick={() => setStatusFilter(s)}
            >
              {s === 'PENDING_REVIEW' ? 'Pending Review' : s === 'HELD' ? 'Held' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-[420px] border-r border-gray-200 overflow-auto bg-white">
          {queueLoading && (
            <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-brand" /></div>
          )}
          {!queueLoading && queueError && (
            <div className="p-3 text-red-700 text-xs flex items-center gap-1" data-testid="queue-error">
              <AlertCircle size={14} /> {(queueError as any)?.status === 403 ? 'Not authorized to view the review queue.' : (queueError as Error).message}
            </div>
          )}
          {!queueLoading && !queueError && cases.length === 0 && (
            <div className="p-8 text-center text-gray-400 text-xs" data-testid="queue-empty">No review cases in this state.</div>
          )}
          {!queueLoading && !queueError && cases.length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Deal#</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Variant</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Ver.</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr
                    key={c.id}
                    data-testid={`queue-row-${c.dealNumber ?? c.id}`}
                    className={`h-9 border-b border-gray-100 cursor-pointer hover:bg-brand-light ${selectedCaseId === c.id ? 'bg-brand-light' : ''}`}
                    onClick={() => selectCase(c)}
                  >
                    <td className="px-3 font-mono">{c.dealNumber ?? '(unresolved)'}</td>
                    <td className="px-3">{c.dealType?.replace('_', ' ') ?? '—'}</td>
                    <td className="px-3">{c.recapVersion}</td>
                    <td className="px-3"><StatusBadge status={c.status} map={CASE_STATUS_BADGE} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!selectedCase && (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">Select a deal from the queue to preview its journal.</div>
          )}
          {selectedCase && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{selectedCase.dealNumber} — v{selectedCase.recapVersion}</div>
                  <div className="text-xs text-gray-500">{selectedCase.dealType?.replace('_', ' ') ?? '—'} · <StatusBadge status={selectedCase.status} map={CASE_STATUS_BADGE} /></div>
                </div>
                {(selectedCase.status === 'PENDING_REVIEW' || selectedCase.status === 'HELD') && (
                  <div className="flex items-center gap-2">
                    <button
                      data-testid={`hold-deal-button-${selectedCase.dealNumber}`}
                      className="h-8 px-3 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50"
                      onClick={() => setHoldOpen(true)}
                    >
                      Hold
                    </button>
                    <button
                      data-testid={`return-deal-button-${selectedCase.dealNumber}`}
                      className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100"
                      onClick={() => setReturnOpen(true)}
                    >
                      Return to desking
                    </button>
                    <button
                      data-testid={`release-deal-button-${selectedCase.dealNumber}`}
                      className="h-8 px-3 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5"
                      disabled={releaseMutation.isPending}
                      onClick={() => releaseMutation.mutate()}
                    >
                      {releaseMutation.isPending ? 'Releasing…' : 'Release'}
                    </button>
                  </div>
                )}
              </div>

              {releaseError && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-start gap-2" data-testid="release-sod-error">
                  <ShieldAlert size={14} className="mt-0.5 shrink-0" /> {releaseError}
                </div>
              )}

              {releasedOutcomes && (
                <div className="mb-4 border border-emerald-200 bg-emerald-50 rounded p-3" data-testid="released-journal-panel">
                  <div className="text-xs font-semibold text-emerald-800 mb-1">Released — resulting posted journal (not the preview)</div>
                  <ReleasedOutcomeTable outcomes={releasedOutcomes} />
                </div>
              )}

              <div className="border border-gray-200 rounded bg-white">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
                  <div className="text-xs font-semibold text-gray-700">Recap-vs-journal preview (coa-service simulate)</div>
                  <button
                    data-testid="refresh-preview-button"
                    className="h-7 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100 flex items-center gap-1"
                    onClick={() => refetchPreview()}
                  >
                    <Search size={12} /> Refresh
                  </button>
                </div>
                <div className="p-3">
                  {previewLoading && <div className="flex items-center justify-center py-8"><Loader2 size={18} className="animate-spin text-brand" /></div>}
                  {!previewLoading && previewError && (
                    <div className="text-xs text-red-600 flex items-center gap-1" data-testid="preview-error">
                      <AlertCircle size={13} /> {(previewError as any)?.status === 403 ? 'Not authorized to preview.' : (previewError as Error).message}
                    </div>
                  )}
                  {!previewLoading && !previewError && preview && (
                    <div className="space-y-3" data-testid="preview-segments">
                      <div className="text-[11px] text-gray-500">Combined blueprint hash: <span className="font-mono">{preview.combinedBlueprintHash}</span></div>
                      {preview.segments.map((seg, i) => (
                        <div key={i} data-testid={`preview-segment-${seg.tag}`}>
                          <div className="text-[11px] font-semibold text-gray-700">{seg.tag} — {seg.eventType}</div>
                          <BlueprintLinesTable segment={seg} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {holdOpen && selectedCase && (
        <ReasonModal
          title={`Hold ${selectedCase.dealNumber}`}
          submitLabel="Hold"
          testIdPrefix="hold-deal"
          busy={holdMutation.isPending}
          error={holdMutation.isError ? (holdMutation.error as any)?.message ?? 'Failed to hold.' : null}
          onSubmit={(reason) => holdMutation.mutate(reason)}
          onClose={() => setHoldOpen(false)}
        />
      )}
      {returnOpen && selectedCase && (
        <ReasonModal
          title={`Return ${selectedCase.dealNumber} to desking`}
          submitLabel="Return"
          testIdPrefix="return-deal"
          busy={returnMutation.isPending}
          error={returnMutation.isError ? (returnMutation.error as any)?.message ?? 'Failed to return.' : null}
          onSubmit={(reason) => returnMutation.mutate(reason)}
          onClose={() => setReturnOpen(false)}
        />
      )}
    </div>
  );
}

const DUE_BILL_STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  FULFILLED: 'bg-emerald-100 text-emerald-700',
};

function NewDueBillModal({ onClose }: { onClose: () => void }) {
  const [dealNumber, setDealNumber] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => ce12DealApi.createDueBill({
      dealNumber: dealNumber.trim(), itemDescription: itemDescription.trim(), amount: amount.trim(), reason: reason.trim(),
      idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce12-due-bills'] });
      onClose();
    },
  });

  const canSubmit = !!dealNumber.trim() && !!itemDescription.trim() && !!amount.trim() && !!reason.trim();

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">New due-bill (we-owe)</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Records a dealer obligation owed to the customer at delivery (missing accessory, pending repair, etc.), tied to a
            specific deal. Posts a real journal immediately (DR deal-receivable clearing / CR due-bill payable). Marking it
            fulfilled here does not itself relieve the schedule-service open item — that relief is a separate operator action.
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Deal# (required)</label>
            <input data-testid="due-bill-deal-number-input" className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1" value={dealNumber} onChange={(e) => setDealNumber(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Item description (required)</label>
            <input data-testid="due-bill-item-description-input" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1" value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Amount (required)</label>
            <input data-testid="due-bill-amount-input" className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Reason (required)</label>
            <input data-testid="due-bill-reason-input" className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {mutation.isError && (
            <div className="text-xs text-red-600 flex items-center gap-1" data-testid="due-bill-new-error">
              <AlertCircle size={13} /> {(mutation.error as any)?.message ?? 'Failed to record due-bill.'}
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>Cancel</button>
          <button
            data-testid="due-bill-new-submit-button"
            className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Recording…' : 'Record due-bill'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DueBillsPanel() {
  const [statusFilter, setStatusFilter] = useState<'OPEN' | 'FULFILLED' | ''>('OPEN');
  const [newOpen, setNewOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ce12-due-bills', statusFilter],
    queryFn: () => ce12DealApi.listDueBills({ status: statusFilter || undefined }),
  });
  const dueBills: DueBill[] = data?.items ?? [];

  const fulfillMutation = useMutation({
    mutationFn: (id: string) => ce12DealApi.fulfillDueBill(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ce12-due-bills'] }),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-3">
        <select
          data-testid="due-bill-status-filter"
          className="h-8 border border-gray-300 rounded px-2 text-xs"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'OPEN' | 'FULFILLED' | '')}
        >
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="FULFILLED">Fulfilled</option>
        </select>
        <button
          data-testid="due-bill-new-button"
          className="h-8 px-3 text-xs bg-brand text-white rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium ml-auto"
          onClick={() => setNewOpen(true)}
        >
          <Plus size={13} /> New due-bill
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin text-brand" /></div>}
        {!isLoading && error && (
          <div className="p-3 text-red-700 text-xs flex items-center gap-1" data-testid="due-bill-error">
            <AlertCircle size={14} /> {(error as any)?.status === 403 ? 'Not authorized to view due-bills.' : (error as Error).message}
            <button className="text-brand hover:underline ml-2" onClick={() => refetch()}>Retry</button>
          </div>
        )}
        {!isLoading && !error && dueBills.length === 0 && (
          <div className="p-8 text-center text-gray-400 text-xs" data-testid="due-bill-empty">No due-bills in this state.</div>
        )}
        {!isLoading && !error && dueBills.length > 0 && (
          <table className="w-full text-xs border-collapse" data-testid="due-bill-table">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Description</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Amount</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Reason</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Journal#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dueBills.map((db) => (
                <tr key={db.id} data-testid={`due-bill-row-${db.id}`} className="h-9 border-b border-gray-100">
                  <td className="px-3">{db.itemDescription}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{db.amount}</td>
                  <td className="px-3">{db.reason}</td>
                  <td className="px-3 font-mono">{db.journalNumber ?? '—'}</td>
                  <td className="px-3"><StatusBadge status={db.status} map={DUE_BILL_STATUS_BADGE} /></td>
                  <td className="px-3">
                    {db.status === 'OPEN' && (
                      <button
                        data-testid={`due-bill-fulfill-button-${db.id}`}
                        className="h-7 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                        disabled={fulfillMutation.isPending}
                        onClick={() => fulfillMutation.mutate(db.id)}
                      >
                        Mark fulfilled
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {newOpen && <NewDueBillModal onClose={() => setNewOpen(false)} />}
    </div>
  );
}

const PAGE_TABS = ['queue', 'duebills'] as const;
type PageTab = (typeof PAGE_TABS)[number];
const PAGE_TAB_LABEL: Record<PageTab, string> = { queue: 'Review Queue', duebills: 'Due Bills (We-Owe)' };

export default function BillerWorkbench() {
  const [pageTab, setPageTab] = useState<PageTab>('queue');

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2 pb-2">
        <h1 className="text-sm font-semibold text-gray-900 mb-2">Biller Review Workbench</h1>
        <div className="flex gap-4">
          {PAGE_TABS.map((t) => (
            <button
              key={t}
              data-testid={`biller-page-tab-${t}`}
              className={`pb-2 text-xs font-medium border-b-2 ${pageTab === t ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
              onClick={() => setPageTab(t)}
            >
              {PAGE_TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {pageTab === 'queue' && <ReviewQueuePanel />}
        {pageTab === 'duebills' && <DueBillsPanel />}
      </div>
    </div>
  );
}

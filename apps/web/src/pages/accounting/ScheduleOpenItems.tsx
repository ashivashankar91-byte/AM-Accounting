// S026 — Schedule Open-Item Core operator UI.
// Distinct from ScheduleInquiry.tsx (a schedprn.cbl-style report over raw
// ScheduleDetail lines): this page manages the open-item lifecycle itself —
// original/applied/remaining balance, status, manual application, reversal —
// plus the nightly GL-to-schedule tie-out.
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, AlertCircle, RotateCcw, PlayCircle } from 'lucide-react';
import { scheduleApi } from '../../api/client';

const fmt = (n: number | string) => {
  const v = typeof n === 'string' ? Number(n) : n;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
};

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—';

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-blue-100 text-blue-700',
  PARTIALLY_APPLIED: 'bg-amber-100 text-amber-700',
  CLOSED: 'bg-gray-100 text-gray-600',
  WRITTEN_OFF: 'bg-purple-100 text-purple-700',
};

const TIE_OUT_BADGE: Record<string, string> = {
  MATCHED: 'bg-emerald-100 text-emerald-700',
  DISCREPANCY: 'bg-red-100 text-red-700',
  GL_UNAVAILABLE: 'bg-gray-200 text-gray-700',
};

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function ApplyModal({
  item, scheduleId, onClose,
}: { item: any; scheduleId: string; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      scheduleApi.applyOpenItem(scheduleId, item.id, {
        amount,
        idempotencyKey: crypto.randomUUID(),
        note: note || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-open-items'] });
      onClose();
    },
    onError: (err: any) => setError(err?.message ?? 'Failed to apply.'),
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">Apply Payment / Credit</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Item <span className="font-mono">{item.itemNumber}</span> — remaining{' '}
            <span className="font-mono">{fmt(item.remainingBalance)}</span>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Amount</label>
            <input
              autoFocus
              data-testid="apply-amount-input"
              className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1 focus:outline-none focus:ring-1 focus:ring-brand"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Note (optional)</label>
            <input
              className="h-8 w-full border border-gray-300 rounded px-2 text-xs mt-1 focus:outline-none focus:ring-1 focus:ring-brand"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error && (
            <div className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            data-testid="apply-submit-button"
            className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
            disabled={!amount || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// S029 — Split ceremony (amount-conserving break into N parts).
function SplitModal({
  item, scheduleId, onClose,
}: { item: any; scheduleId: string; onClose: () => void }) {
  const [parts, setParts] = useState<string[]>(['', '']);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      scheduleApi.splitOpenItem(scheduleId, item.id, {
        parts: parts.filter((p) => p.trim().length > 0),
        idempotencyKey: crypto.randomUUID(),
        reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-open-items'] });
      onClose();
    },
    onError: (err: any) => setError(err?.message ?? 'Failed to split.'),
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">Split Open Item</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Item <span className="font-mono">{item.itemNumber}</span> — remaining{' '}
            <span className="font-mono">{fmt(item.remainingBalance)}</span>. Parts must sum to the remaining balance exactly.
          </div>
          {parts.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="text-xs font-medium text-gray-600 w-14">Part {i + 1}</label>
              <input
                data-testid={`split-part-input-${i}`}
                className="h-8 flex-1 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
                value={p}
                onChange={(e) => setParts((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))}
                placeholder="0.00"
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button className="text-xs text-brand hover:underline" onClick={() => setParts((prev) => [...prev, ''])}>
              + Add part
            </button>
            {parts.length > 2 && (
              <button className="text-xs text-gray-500 hover:underline" onClick={() => setParts((prev) => prev.slice(0, -1))}>
                Remove last
              </button>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Reason (required)</label>
            <input
              data-testid="split-reason-input"
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
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            data-testid="split-submit-button"
            className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
            disabled={!reason || parts.filter((p) => p.trim()).length < 2 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Splitting…' : 'Split'}
          </button>
        </div>
      </div>
    </div>
  );
}

// S029 — Transfer ceremony (within-schedule control-number move; D-CE08-04
// cross-schedule transfer is explicitly out of scope, enforced server-side).
function TransferModal({
  item, scheduleId, onClose,
}: { item: any; scheduleId: string; onClose: () => void }) {
  const [toControlNumber, setToControlNumber] = useState('');
  const [toItemNumber, setToItemNumber] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      scheduleApi.transferOpenItem(scheduleId, item.id, {
        toScheduleNumber: item.scheduleNumber,
        toControlNumber,
        toItemNumber,
        idempotencyKey: crypto.randomUUID(),
        reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-open-items'] });
      onClose();
    },
    onError: (err: any) => setError(err?.message ?? 'Failed to transfer.'),
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">Transfer Open Item</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Item <span className="font-mono">{item.itemNumber}</span> — transfers within schedule{' '}
            <span className="font-mono">{item.scheduleNumber}</span> only (cross-schedule transfer is not permitted).
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">To Control#</label>
            <input
              data-testid="transfer-to-control-input"
              className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1 focus:outline-none focus:ring-1 focus:ring-brand"
              value={toControlNumber}
              onChange={(e) => setToControlNumber(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">To Item#</label>
            <input
              data-testid="transfer-to-item-input"
              className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1 focus:outline-none focus:ring-1 focus:ring-brand"
              value={toItemNumber}
              onChange={(e) => setToItemNumber(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Reason (required)</label>
            <input
              data-testid="transfer-reason-input"
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
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            data-testid="transfer-submit-button"
            className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
            disabled={!toControlNumber || !toItemNumber || !reason || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Transferring…' : 'Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// S029 — Write-off ceremony. Posts a real GL journal entry through
// gl-service (approved D-CE08-02 threshold-config path); offset account is
// always caller-supplied, never inferred/invented.
function WriteOffModal({
  item, scheduleId, onClose,
}: { item: any; scheduleId: string; onClose: () => void }) {
  const [offsetAccountCode, setOffsetAccountCode] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      scheduleApi.writeOffOpenItem(scheduleId, item.id, {
        offsetAccountCode,
        idempotencyKey: crypto.randomUUID(),
        reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule-open-items'] });
      onClose();
    },
    onError: (err: any) => setError(err?.message ?? 'Failed to write off.'),
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-red-600 text-white rounded-t">
          <span className="text-sm font-semibold">Write Off Open Item</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Item <span className="font-mono">{item.itemNumber}</span> — remaining{' '}
            <span className="font-mono">{fmt(item.remainingBalance)}</span>. This posts a GL journal entry and cannot
            be undone from this screen.
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Offset GL Account (required)</label>
            <input
              data-testid="writeoff-offset-account-input"
              className="h-8 w-full border border-gray-300 rounded px-2 text-xs font-mono mt-1 focus:outline-none focus:ring-1 focus:ring-brand"
              value={offsetAccountCode}
              onChange={(e) => setOffsetAccountCode(e.target.value)}
              placeholder="e.g. 6300"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Reason (required)</label>
            <input
              data-testid="writeoff-reason-input"
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
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            data-testid="writeoff-submit-button"
            className="h-8 px-4 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            disabled={!offsetAccountCode || !reason || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Writing off…' : 'Write Off'}
          </button>
        </div>
      </div>
    </div>
  );
}

// S028 — Auto-Apply (FIFO sweep on-account) confirmation modal. Shows the
// server-computed eligible open items for the schedule/control# pair (never
// computed in the browser) and the amount to sweep, then requires an
// explicit confirmation click before calling the real S028 API.
function AutoApplyConfirmModal({
  scheduleId, controlNumber, amount, eligibleItems, onClose, onConfirmed,
}: {
  scheduleId: string;
  controlNumber: string;
  amount: string;
  eligibleItems: any[];
  onClose: () => void;
  onConfirmed: (outcome: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      scheduleApi.autoApply({
        scheduleNumber: scheduleId,
        controlNumber,
        amount,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ['schedule-open-items'] });
      qc.invalidateQueries({ queryKey: ['schedule-auto-apply-eligible'] });
      onConfirmed(result?.outcome ?? 'AUTO_APPLIED');
    },
    onError: (err: any) => setError(err?.message ?? 'Failed to auto-apply.'),
  });

  return (
    <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded shadow-xl">
        <div className="flex items-center justify-between px-4 py-2 bg-brand text-white rounded-t">
          <span className="text-sm font-semibold">Confirm FIFO Auto-Apply</span>
          <button onClick={onClose}>&times;</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-gray-500">
            Control# <span className="font-mono">{controlNumber}</span> — applying{' '}
            <span className="font-mono">{fmt(amount)}</span> against the oldest eligible open items first
            (FIFO), per the S028 relieving policy. The exact split across items is computed server-side —
            this screen never calculates it.
          </div>
          <div className="border border-gray-200 rounded max-h-48 overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                  <th className="text-left px-2 py-1 font-medium">Item#</th>
                  <th className="text-left px-2 py-1 font-medium">Due</th>
                  <th className="text-right px-2 py-1 font-medium">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {eligibleItems.map((it) => (
                  <tr key={it.id} data-testid={`auto-apply-eligible-row-${it.itemNumber}`} className="border-b border-gray-100">
                    <td className="px-2 py-1 font-mono">{it.itemNumber}</td>
                    <td className="px-2 py-1">{fmtDate(it.dueDate)}</td>
                    <td className="px-2 py-1 font-mono text-right">{fmt(it.remainingBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && (
            <div className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle size={13} /> {error}
            </div>
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-200 flex justify-end gap-2">
          <button className="h-8 px-3 text-xs border border-gray-300 rounded hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            data-testid="auto-apply-confirm-button"
            className="h-8 px-4 text-xs bg-brand text-white rounded hover:bg-brand-hover disabled:opacity-50"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Applying…' : 'Confirm Auto-Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

// S028 — FIFO auto-apply tab. Operator marks an unallocated receipt
// "apply on account" for a schedule/control#: the eligible open items are
// fetched from the real S026 open-items API (never fabricated), the amount
// is entered, and — after explicit confirmation — the real
// POST /api/v1/schedules/open-items/auto-apply endpoint performs the FIFO
// sweep and returns the authoritative outcome and resulting balances.
function AutoApplyTab({ scheduleId }: { scheduleId: string }) {
  const [controlNumber, setControlNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [lastResult, setLastResult] = useState<{ outcome: string } | null>(null);

  const { data: eligibleItems, isLoading, error, refetch, isFetched } = useQuery<any[]>({
    queryKey: ['schedule-auto-apply-eligible', scheduleId, controlNumber],
    queryFn: () => scheduleApi.getOpenItems(scheduleId, `controlNumber=${encodeURIComponent(controlNumber)}&status=OPEN`),
    enabled: false,
  });

  const items = eligibleItems ?? [];
  const canSearch = !!scheduleId && !!controlNumber;
  const canApply = canSearch && !!amount && items.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">Control#:</label>
          <input
            data-testid="auto-apply-control-input"
            className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={controlNumber}
            onChange={(e) => setControlNumber(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">Amount:</label>
          <input
            data-testid="auto-apply-amount-input"
            className="h-8 w-28 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <button
          data-testid="auto-apply-search-button"
          className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 flex items-center gap-1.5 font-medium disabled:opacity-50"
          disabled={!canSearch}
          onClick={() => refetch()}
        >
          <Search size={13} /> Find Eligible Items
        </button>
        <button
          data-testid="auto-apply-open-confirm-button"
          className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover disabled:opacity-50 font-medium"
          disabled={!canApply}
          onClick={() => setConfirming(true)}
        >
          FIFO Auto-Apply
        </button>
      </div>

      {lastResult && (
        <div data-testid="auto-apply-result-banner" className="px-4 py-2 text-xs bg-emerald-50 text-emerald-700 border-b border-emerald-100">
          Result: <span className="font-mono font-semibold">{lastResult.outcome}</span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm" data-testid="auto-apply-error-banner">
            <AlertCircle size={16} /> {(error as any)?.status === 403
              ? 'You do not have permission to view or apply open items.'
              : (error as Error).message}
          </div>
        )}
        {!isLoading && !error && isFetched && items.length === 0 && (
          <div className="text-center py-16 text-gray-400 text-sm" data-testid="auto-apply-empty-state">
            No eligible open items found for this schedule/control#.
          </div>
        )}
        {!isLoading && !error && items.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Item#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Due</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium">Remaining</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any) => (
                <tr key={it.id} data-testid={`auto-apply-eligible-row-${it.itemNumber}`} className="h-9 border-b border-gray-100">
                  <td className="px-3 font-mono">{it.itemNumber}</td>
                  <td className="px-3">{fmtDate(it.dueDate)}</td>
                  <td className="px-3 font-mono text-right">{fmt(it.remainingBalance)}</td>
                  <td className="px-3">
                    <StatusBadge status={it.status} map={STATUS_BADGE} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirming && (
        <AutoApplyConfirmModal
          scheduleId={scheduleId}
          controlNumber={controlNumber}
          amount={amount}
          eligibleItems={items}
          onClose={() => setConfirming(false)}
          onConfirmed={(outcome) => {
            setConfirming(false);
            setLastResult({ outcome });
            refetch();
          }}
        />
      )}
    </div>
  );
}

function OpenItemsTab({ scheduleId }: { scheduleId: string }) {
  const [controlNumber, setControlNumber] = useState('');
  const [status, setStatus] = useState('');
  const [applyTarget, setApplyTarget] = useState<any | null>(null);
  const [splitTarget, setSplitTarget] = useState<any | null>(null);
  const [transferTarget, setTransferTarget] = useState<any | null>(null);
  const [writeOffTarget, setWriteOffTarget] = useState<any | null>(null);
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (controlNumber) params.set('controlNumber', controlNumber);
  if (status) params.set('status', status);

  const { data, isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['schedule-open-items', scheduleId, controlNumber, status],
    queryFn: () => scheduleApi.getOpenItems(scheduleId, params.toString()),
    enabled: !!scheduleId,
  });

  const reverseMutation = useMutation({
    mutationFn: (applicationId: string) => scheduleApi.reverseApplication(scheduleId, applicationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-open-items'] }),
  });

  const items = data ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">Control#:</label>
          <input
            data-testid="open-items-control-filter"
            className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={controlNumber}
            onChange={(e) => setControlNumber(e.target.value)}
            placeholder="(blank=all)"
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">Status:</label>
          <select
            className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="PARTIALLY_APPLIED">Partially Applied</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <button
          data-testid="open-items-search-button"
          className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium"
          onClick={() => refetch()}
        >
          <Search size={13} /> Search
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {!scheduleId && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Enter a schedule number to view open items.
          </div>
        )}
        {scheduleId && isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}
        {scheduleId && !isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as Error).message}
          </div>
        )}
        {scheduleId && !isLoading && !error && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Item#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Control#</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Original</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Applied</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Remaining</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-20">Due</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-32">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-400">
                    No open items found.
                  </td>
                </tr>
              )}
              {items.map((item: any) => (
                <Fragment key={item.id}>
                  <tr data-testid={`open-item-row-${item.itemNumber}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                    <td className="px-3 font-mono">{item.itemNumber}</td>
                    <td className="px-3 font-mono">{item.controlNumber}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{fmt(item.originalAmount)}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{fmt(item.appliedAmount)}</td>
                    <td className="px-3 text-right font-mono tabular-nums font-semibold">{fmt(item.remainingBalance)}</td>
                    <td className="px-3">{fmtDate(item.dueDate)}</td>
                    <td className="px-3">
                      <StatusBadge status={item.status} map={STATUS_BADGE} />
                    </td>
                    <td className="px-3">
                      {item.status !== 'CLOSED' && item.status !== 'WRITTEN_OFF' && (
                        <div className="flex items-center gap-1">
                          <button
                            data-testid={`apply-button-${item.itemNumber}`}
                            className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100"
                            onClick={() => setApplyTarget(item)}
                          >
                            Apply
                          </button>
                          <button
                            data-testid={`split-button-${item.itemNumber}`}
                            className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100"
                            onClick={() => setSplitTarget(item)}
                          >
                            Split
                          </button>
                          <button
                            data-testid={`transfer-button-${item.itemNumber}`}
                            className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100"
                            onClick={() => setTransferTarget(item)}
                          >
                            Transfer
                          </button>
                          <button
                            data-testid={`writeoff-button-${item.itemNumber}`}
                            className="h-6 px-2 text-[11px] border border-red-300 text-red-600 rounded hover:bg-red-50"
                            onClick={() => setWriteOffTarget(item)}
                          >
                            Write Off
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {Array.isArray(item.applications) && item.applications.length > 0 && (
                    <tr className="bg-gray-50">
                      <td colSpan={8} className="px-3 py-1">
                        <div className="flex flex-col gap-0.5">
                          {item.applications.map((app: any) => (
                            <div key={app.id} className="flex items-center gap-3 text-[11px] text-gray-600">
                              <span className="w-20">{fmtDate(app.appliedAt)}</span>
                              <span className="font-mono w-20 text-right">{fmt(app.amount)}</span>
                              <span>{app.isManual ? 'Manual' : 'Posted'}</span>
                              {app.reversedAt ? (
                                <span className="text-gray-400 italic">reversed {fmtDate(app.reversedAt)}</span>
                              ) : (
                                <button
                                  data-testid={`reverse-button-${app.id}`}
                                  className="flex items-center gap-1 text-red-600 hover:underline"
                                  onClick={() => reverseMutation.mutate(app.id)}
                                >
                                  <RotateCcw size={11} /> Reverse
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {applyTarget && (
        <ApplyModal item={applyTarget} scheduleId={scheduleId} onClose={() => setApplyTarget(null)} />
      )}
      {splitTarget && (
        <SplitModal item={splitTarget} scheduleId={scheduleId} onClose={() => setSplitTarget(null)} />
      )}
      {transferTarget && (
        <TransferModal item={transferTarget} scheduleId={scheduleId} onClose={() => setTransferTarget(null)} />
      )}
      {writeOffTarget && (
        <WriteOffModal item={writeOffTarget} scheduleId={scheduleId} onClose={() => setWriteOffTarget(null)} />
      )}
    </div>
  );
}

function TieOutTab() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery<any[]>({
    queryKey: ['schedule-tie-outs'],
    queryFn: () => scheduleApi.getTieOuts('latest=true'),
  });

  const runMutation = useMutation({
    mutationFn: () => scheduleApi.runTieOut(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-tie-outs'] }),
  });

  const rows = data ?? [];
  const discrepancyCount = rows.filter((r: any) => r.status === 'DISCREPANCY').length;

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
        <div className="text-xs text-gray-600">
          {rows.length > 0 ? (
            <>
              Latest run — {rows.length} account(s) checked
              {discrepancyCount > 0 && (
                <span className="ml-2 text-red-600 font-medium">{discrepancyCount} discrepancy(ies)</span>
              )}
            </>
          ) : (
            'No tie-out has run yet.'
          )}
        </div>
        <button
          data-testid="run-tie-out-button"
          className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium disabled:opacity-50"
          disabled={runMutation.isPending}
          onClick={() => runMutation.mutate()}
        >
          <PlayCircle size={13} /> {runMutation.isPending ? 'Running…' : 'Run Tie-Out Now'}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as Error).message}
          </div>
        )}
        {!isLoading && !error && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-20">Schedule</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">GL Account</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">As Of</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-28">Schedule Bal.</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-28">GL Bal.</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-28">Variance</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-32">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    Run a tie-out to see results.
                  </td>
                </tr>
              )}
              {rows.map((r: any) => (
                <tr key={r.id} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                  <td className="px-3 font-mono">{r.scheduleNumber}</td>
                  <td className="px-3 font-mono">{r.glAccountNumber}</td>
                  <td className="px-3">{fmtDate(r.asOfDate)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(r.scheduleBalance)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{r.glBalance != null ? fmt(r.glBalance) : '—'}</td>
                  <td className={`px-3 text-right font-mono tabular-nums ${r.variance && Number(r.variance) !== 0 ? 'text-red-600 font-semibold' : ''}`}>
                    {r.variance != null ? fmt(r.variance) : '—'}
                  </td>
                  <td className="px-3">
                    <StatusBadge status={r.status} map={TIE_OUT_BADGE} />
                    {r.glQueryError && (
                      <div className="text-[10px] text-gray-400 mt-0.5" title={r.glQueryError}>
                        {r.glQueryError.slice(0, 40)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AgingTab({ scheduleId }: { scheduleId: string }) {
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().slice(0, 10));
  const [controlNumber, setControlNumber] = useState('');

  const params = new URLSearchParams();
  params.set('asOfDate', asOfDate);
  if (controlNumber) params.set('controlNumber', controlNumber);

  const { data, isLoading, error, refetch } = useQuery<any>({
    queryKey: ['schedule-aging-report', scheduleId, asOfDate, controlNumber],
    queryFn: () => scheduleApi.getAgingReport(scheduleId || null, params.toString()),
  });

  const buckets: any[] = data?.buckets ?? [];
  const bucketTotals: any[] = data?.bucketTotals ?? [];
  const rows: any[] = data?.rows ?? [];
  const reconciliation = data?.reconciliation;

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">As Of:</label>
          <input
            type="date"
            data-testid="aging-as-of-date"
            className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">Control#:</label>
          <input
            className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={controlNumber}
            onChange={(e) => setControlNumber(e.target.value)}
            placeholder="(blank=all)"
          />
        </div>
        <button
          data-testid="aging-refresh-button"
          className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium"
          onClick={() => refetch()}
        >
          <Search size={13} /> Refresh
        </button>
        {reconciliation && (
          <span
            data-testid="aging-reconciliation-badge"
            className={`ml-auto text-[11px] px-2 py-1 rounded font-medium ${
              reconciliation.matches ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {reconciliation.matches
              ? `Reconciles to open-item total: ${reconciliation.openItemTotal}`
              : `RECONCILIATION MISMATCH — aging ${reconciliation.agingTotal} vs open items ${reconciliation.openItemTotal}`}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as Error).message}
          </div>
        )}
        {!isLoading && !error && (
          <>
            <div className="flex gap-2 px-4 py-3">
              {bucketTotals.map((b) => (
                <div key={b.label} className="flex-1 border border-gray-200 rounded p-2 bg-white">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500">{b.label}</div>
                  <div className="font-mono text-sm font-semibold tabular-nums">{fmt(b.total)}</div>
                  <div className="text-[10px] text-gray-400">{b.itemCount} item(s)</div>
                </div>
              ))}
              <div className="flex-1 border border-brand rounded p-2 bg-brand-light">
                <div className="text-[10px] uppercase tracking-wide text-brand">Total</div>
                <div className="font-mono text-sm font-semibold tabular-nums">{data ? fmt(data.grandTotal) : '—'}</div>
              </div>
            </div>

            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-20">Schedule</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Control#</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Item#</th>
                  <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Remaining</th>
                  <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-16">Age</th>
                  <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Bucket</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gray-400">
                      No aged open items found.
                    </td>
                  </tr>
                )}
                {rows.map((r: any, i: number) => (
                  <tr key={`${r.scheduleNumber}-${r.itemNumber}-${i}`} className="h-9 border-b border-gray-100 hover:bg-brand-light">
                    <td className="px-3 font-mono">{r.scheduleNumber}</td>
                    <td className="px-3 font-mono">{r.controlNumber}</td>
                    <td className="px-3 font-mono">{r.itemNumber}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{fmt(r.remainingBalance)}</td>
                    <td className="px-3 text-right font-mono tabular-nums">{r.ageDays}</td>
                    <td className="px-3">{r.bucket}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// S027 completion — Exception queue (STALE, CREDIT_BALANCE_ON_DEBIT_ACCOUNT,
// MISSING_REFERENCE, OVER_CONTROL_LIMIT rule types).
const EXCEPTION_BADGE: Record<string, string> = {
  OPEN: 'bg-amber-100 text-amber-700',
  DISPOSITIONED: 'bg-gray-100 text-gray-600',
};

function ExceptionsTab() {
  const [status, setStatus] = useState('OPEN');
  const [note, setNote] = useState<Record<string, string>>({});
  const qc = useQueryClient();

  const params = new URLSearchParams();
  if (status) params.set('status', status);

  const { data, isLoading, error, refetch } = useQuery<any[]>({
    queryKey: ['schedule-exceptions', status],
    queryFn: () => scheduleApi.getExceptions(params.toString()),
  });

  const runMutation = useMutation({
    mutationFn: () => scheduleApi.runExceptionEvaluation(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-exceptions'] }),
  });

  const dispositionMutation = useMutation({
    mutationFn: ({ id, noteText }: { id: string; noteText: string }) => scheduleApi.dispositionException(id, noteText),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-exceptions'] }),
  });

  const rows = data ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">Status:</label>
          <select
            className="h-8 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="OPEN">Open</option>
            <option value="DISPOSITIONED">Dispositioned</option>
            <option value="">All</option>
          </select>
        </div>
        <button
          data-testid="exceptions-search-button"
          className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 flex items-center gap-1.5 font-medium"
          onClick={() => refetch()}
        >
          <Search size={13} /> Search
        </button>
        <button
          data-testid="run-exception-evaluation-button"
          className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover flex items-center gap-1.5 font-medium disabled:opacity-50"
          disabled={runMutation.isPending}
          onClick={() => runMutation.mutate()}
        >
          <PlayCircle size={13} /> {runMutation.isPending ? 'Evaluating…' : 'Run Exception Evaluation'}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-brand" />
          </div>
        )}
        {!isLoading && error && (
          <div className="flex items-center gap-2 p-4 text-red-700 text-sm">
            <AlertCircle size={16} /> {(error as Error).message}
          </div>
        )}
        {!isLoading && !error && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide sticky top-0">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-20">Schedule</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Control#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Item#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-44">Rule</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium">Detail</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Status</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-64">Disposition</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    No exceptions found.
                  </td>
                </tr>
              )}
              {rows.map((r: any) => (
                <tr key={r.id} className="h-9 border-b border-gray-100 hover:bg-brand-light align-top">
                  <td className="px-3 font-mono pt-2">{r.scheduleNumber}</td>
                  <td className="px-3 font-mono pt-2">{r.controlNumber}</td>
                  <td className="px-3 font-mono pt-2">{r.itemNumber ?? '—'}</td>
                  <td className="px-3 pt-2">{r.ruleType}</td>
                  <td className="px-3 pt-2 text-gray-600">{r.detail ?? '—'}</td>
                  <td className="px-3 pt-2">
                    <StatusBadge status={r.status} map={EXCEPTION_BADGE} />
                  </td>
                  <td className="px-3 py-1.5">
                    {r.status === 'OPEN' ? (
                      <div className="flex items-center gap-1">
                        <input
                          data-testid={`disposition-note-${r.id}`}
                          className="h-7 flex-1 border border-gray-300 rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-brand"
                          value={note[r.id] ?? ''}
                          onChange={(e) => setNote((prev) => ({ ...prev, [r.id]: e.target.value }))}
                          placeholder="Resolution note"
                        />
                        <button
                          data-testid={`disposition-button-${r.id}`}
                          className="h-7 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
                          disabled={!note[r.id] || dispositionMutation.isPending}
                          onClick={() => dispositionMutation.mutate({ id: r.id, noteText: note[r.id] })}
                        >
                          Resolve
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-500 italic">{r.dispositionNote ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// S030 — Statements & dunning.
function StatementsTab() {
  const [scheduleNumber, setScheduleNumber] = useState('');
  const [controlNumber, setControlNumber] = useState('');
  const qc = useQueryClient();

  const generateStatementMutation = useMutation({
    mutationFn: () => scheduleApi.generateStatement({ scheduleNumber, controlNumber }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-statements'] }),
  });

  const generateDunningMutation = useMutation({
    mutationFn: () => scheduleApi.generateDunning({ scheduleNumber, controlNumber }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule-dunning'] }),
  });

  const { data: statements, isLoading: statementsLoading } = useQuery<any[]>({
    queryKey: ['schedule-statements', scheduleNumber, controlNumber],
    queryFn: () => {
      const p = new URLSearchParams();
      if (scheduleNumber) p.set('scheduleNumber', scheduleNumber);
      if (controlNumber) p.set('controlNumber', controlNumber);
      return scheduleApi.listStatementRuns(p.toString());
    },
  });

  const { data: dunningRuns, isLoading: dunningLoading } = useQuery<any[]>({
    queryKey: ['schedule-dunning', scheduleNumber, controlNumber],
    queryFn: () => {
      const p = new URLSearchParams();
      if (scheduleNumber) p.set('scheduleNumber', scheduleNumber);
      if (controlNumber) p.set('controlNumber', controlNumber);
      return scheduleApi.listDunningRuns(p.toString());
    },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center flex-wrap gap-3">
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">Schedule#:</label>
          <input
            data-testid="statements-schedule-input"
            className="h-8 w-20 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={scheduleNumber}
            onChange={(e) => setScheduleNumber(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs font-medium text-gray-600">Control#:</label>
          <input
            data-testid="statements-control-input"
            className="h-8 w-32 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
            value={controlNumber}
            onChange={(e) => setControlNumber(e.target.value)}
          />
        </div>
        <button
          data-testid="generate-statement-button"
          className="h-8 px-3 bg-brand text-white text-xs rounded hover:bg-brand-hover disabled:opacity-50 font-medium"
          disabled={!scheduleNumber || !controlNumber || generateStatementMutation.isPending}
          onClick={() => generateStatementMutation.mutate()}
        >
          {generateStatementMutation.isPending ? 'Generating…' : 'Generate Statement'}
        </button>
        <button
          data-testid="generate-dunning-button"
          className="h-8 px-3 border border-gray-300 text-xs rounded hover:bg-gray-100 disabled:opacity-50 font-medium"
          disabled={!scheduleNumber || !controlNumber || generateDunningMutation.isPending}
          onClick={() => generateDunningMutation.mutate()}
        >
          {generateDunningMutation.isPending ? 'Generating…' : 'Generate Dunning'}
        </button>
      </div>
      {(generateStatementMutation.isError || generateDunningMutation.isError) && (
        <div className="px-4 py-2 text-xs text-red-600">
          {(generateStatementMutation.error as any)?.message ?? (generateDunningMutation.error as any)?.message}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">Statement Runs</div>
        {statementsLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand" /></div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-20">Schedule</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Control#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">As Of</th>
                <th className="text-right px-3 py-1.5 border-b border-gray-200 font-medium w-24">Balance</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Channel</th>
              </tr>
            </thead>
            <tbody>
              {(statements ?? []).length === 0 && (
                <tr><td colSpan={5} className="text-center py-6 text-gray-400">No statement runs yet.</td></tr>
              )}
              {(statements ?? []).map((s: any) => (
                <tr key={s.id} className="h-8 border-b border-gray-100">
                  <td className="px-3 font-mono">{s.scheduleNumber}</td>
                  <td className="px-3 font-mono">{s.controlNumber}</td>
                  <td className="px-3">{fmtDate(s.asOfDate)}</td>
                  <td className="px-3 text-right font-mono tabular-nums">{fmt(s.endingBalance)}</td>
                  <td className="px-3">{s.deliveryChannel ?? 'PRINT_PDF'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide mt-2">Dunning Runs</div>
        {dunningLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-brand" /></div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600 uppercase tracking-wide">
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-20">Schedule</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-24">Control#</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-16">Level</th>
                <th className="text-left px-3 py-1.5 border-b border-gray-200 font-medium w-28">Generated</th>
              </tr>
            </thead>
            <tbody>
              {(dunningRuns ?? []).length === 0 && (
                <tr><td colSpan={4} className="text-center py-6 text-gray-400">No dunning runs yet.</td></tr>
              )}
              {(dunningRuns ?? []).map((d: any) => (
                <tr key={d.id} className="h-8 border-b border-gray-100">
                  <td className="px-3 font-mono">{d.scheduleNumber}</td>
                  <td className="px-3 font-mono">{d.controlNumber}</td>
                  <td className="px-3">{d.level}</td>
                  <td className="px-3">{fmtDate(d.generatedAt ?? d.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function ScheduleOpenItems() {
  const [searchParams] = useSearchParams();
  const [scheduleId, setScheduleId] = useState(searchParams.get('schedule') ?? '');
  // Honors ?tab=tieout so Command Center's schedule-variance exception tile
  // lands directly on the GL Tie-Out sub-tab, not the default Open Items
  // view — per the value-doctrine "action test".
  const initialTab = (['items', 'tieout', 'aging', 'exceptions', 'statements', 'auto-apply'] as const).includes(searchParams.get('tab') as any)
    ? (searchParams.get('tab') as 'items' | 'tieout' | 'aging' | 'exceptions' | 'statements' | 'auto-apply')
    : 'items';
  const [tab, setTab] = useState<'items' | 'tieout' | 'aging' | 'exceptions' | 'statements' | 'auto-apply'>(initialTab);

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2">
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-sm font-semibold text-gray-900">Schedule Open Items</h1>
          {(tab === 'items' || tab === 'aging' || tab === 'auto-apply') && (
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-gray-600">Schedule:</label>
              <input
                data-testid="open-items-schedule-input"
                className="h-7 w-20 border border-gray-300 rounded px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-brand"
                value={scheduleId}
                onChange={(e) => setScheduleId(e.target.value)}
                placeholder="#"
              />
            </div>
          )}
        </div>
        <div className="flex gap-4">
          <button
            className={`pb-2 text-xs font-medium border-b-2 ${tab === 'items' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
            onClick={() => setTab('items')}
          >
            Open Items
          </button>
          <button
            data-testid="tie-out-tab-button"
            className={`pb-2 text-xs font-medium border-b-2 ${tab === 'tieout' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
            onClick={() => setTab('tieout')}
          >
            GL Tie-Out
          </button>
          <button
            data-testid="aging-tab-button"
            className={`pb-2 text-xs font-medium border-b-2 ${tab === 'aging' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
            onClick={() => setTab('aging')}
          >
            Aging Report
          </button>
          <button
            data-testid="exceptions-tab-button"
            className={`pb-2 text-xs font-medium border-b-2 ${tab === 'exceptions' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
            onClick={() => setTab('exceptions')}
          >
            Exceptions
          </button>
          <button
            data-testid="statements-tab-button"
            className={`pb-2 text-xs font-medium border-b-2 ${tab === 'statements' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
            onClick={() => setTab('statements')}
          >
            Statements &amp; Dunning
          </button>
          <button
            data-testid="auto-apply-tab-button"
            className={`pb-2 text-xs font-medium border-b-2 ${tab === 'auto-apply' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
            onClick={() => setTab('auto-apply')}
          >
            FIFO Auto-Apply
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'items' && <OpenItemsTab scheduleId={scheduleId} />}
        {tab === 'tieout' && <TieOutTab />}
        {tab === 'aging' && <AgingTab scheduleId={scheduleId} />}
        {tab === 'exceptions' && <ExceptionsTab />}
        {tab === 'statements' && <StatementsTab />}
        {tab === 'auto-apply' && <AutoApplyTab scheduleId={scheduleId} />}
      </div>
    </div>
  );
}

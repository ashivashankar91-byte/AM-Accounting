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

function OpenItemsTab({ scheduleId }: { scheduleId: string }) {
  const [controlNumber, setControlNumber] = useState('');
  const [status, setStatus] = useState('');
  const [applyTarget, setApplyTarget] = useState<any | null>(null);
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
                      {item.status !== 'CLOSED' && (
                        <button
                          data-testid={`apply-button-${item.itemNumber}`}
                          className="h-6 px-2 text-[11px] border border-gray-300 rounded hover:bg-gray-100"
                          onClick={() => setApplyTarget(item)}
                        >
                          Apply
                        </button>
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

export default function ScheduleOpenItems() {
  const [searchParams] = useSearchParams();
  const [scheduleId, setScheduleId] = useState(searchParams.get('schedule') ?? '');
  const [tab, setTab] = useState<'items' | 'tieout' | 'aging'>('items');

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-[Inter,sans-serif] text-sm">
      <div className="bg-white border-b border-gray-200 px-4 pt-2">
        <div className="flex items-center gap-4 mb-2">
          <h1 className="text-sm font-semibold text-gray-900">Schedule Open Items</h1>
          {(tab === 'items' || tab === 'aging') && (
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
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'items' && <OpenItemsTab scheduleId={scheduleId} />}
        {tab === 'tieout' && <TieOutTab />}
        {tab === 'aging' && <AgingTab scheduleId={scheduleId} />}
      </div>
    </div>
  );
}

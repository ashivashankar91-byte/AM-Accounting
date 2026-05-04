import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { eomApi } from '../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReadinessCondition {
  code: string;
  description: string;
  severity: 'BLOCKING' | 'WARNING' | 'OK';
  details?: string;
}

interface PreviewData {
  period: { year: number; month: number };
  readiness: ReadinessCondition[];
  schedulesToPurge: SchedulePurgeItem[];
  estimatedDuration?: number;
}

interface SchedulePurgeItem {
  scheduleId: string;
  description: string;
  itemCount: number;
  totalAmount: number;
}

interface CloseStep {
  stepCode: string;
  stepName: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'BLOCKED' | 'SKIPPED';
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  retryCount?: number;
  durationMs?: number;
}

interface CloseRecord {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  startedAt: string;
  completedAt?: string;
  blockedReason?: string;
  steps: CloseStep[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                 'July', 'August', 'September', 'October', 'November', 'December'];

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function periodLabel(year: number, month: number) {
  return `${MONTHS[month - 1]} ${year}`;
}

// ─── Readiness Panel ──────────────────────────────────────────────────────────

function ReadinessPanel({ conditions }: { conditions: ReadinessCondition[] }) {
  const blocking = conditions.filter(c => c.severity === 'BLOCKING');
  const warnings = conditions.filter(c => c.severity === 'WARNING');
  const ok = conditions.filter(c => c.severity === 'OK');

  if (conditions.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
        <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        All readiness checks passed — period is ready to close
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {blocking.map(c => (
        <div key={c.code} className="flex gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <div className="text-sm font-semibold text-red-800">{c.description}</div>
            {c.details && <div className="text-xs text-red-600 mt-0.5">{c.details}</div>}
          </div>
          <span className="ml-auto text-xs font-bold text-red-700 uppercase tracking-wide bg-red-100 px-2 py-0.5 rounded self-start">BLOCKING</span>
        </div>
      ))}
      {warnings.map(c => (
        <div key={c.code} className="flex gap-3 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div>
            <div className="text-sm font-semibold text-yellow-800">{c.description}</div>
            {c.details && <div className="text-xs text-yellow-700 mt-0.5">{c.details}</div>}
          </div>
          <span className="ml-auto text-xs font-bold text-yellow-700 uppercase tracking-wide bg-yellow-100 px-2 py-0.5 rounded self-start">WARNING</span>
        </div>
      ))}
      {ok.map(c => (
        <div key={c.code} className="flex gap-3 px-4 py-2 bg-green-50 border border-green-100 rounded-lg">
          <svg className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          <div className="text-sm text-green-700">{c.description}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Step Progress ────────────────────────────────────────────────────────────

const STEP_STATUS_CONFIG = {
  PENDING: { bg: 'bg-gray-50', border: 'border-gray-200', dot: 'bg-gray-300', text: 'text-gray-500', pulse: false },
  RUNNING: { bg: 'bg-blue-50', border: 'border-blue-300', dot: 'bg-blue-500', text: 'text-blue-700', pulse: true },
  DONE: { bg: 'bg-green-50', border: 'border-green-300', dot: 'bg-green-500', text: 'text-green-700', pulse: false },
  BLOCKED: { bg: 'bg-red-50', border: 'border-red-300', dot: 'bg-red-500', text: 'text-red-700', pulse: false },
  SKIPPED: { bg: 'bg-gray-50', border: 'border-gray-200', dot: 'bg-gray-200', text: 'text-gray-400', pulse: false },
};

function StepCard({ step, idx }: { step: CloseStep; idx: number }) {
  const cfg = STEP_STATUS_CONFIG[step.status] ?? STEP_STATUS_CONFIG.PENDING;
  return (
    <div className={`flex-1 min-w-[120px] rounded-lg p-3 border ${cfg.bg} ${cfg.border} text-center relative overflow-hidden`}>
      {cfg.pulse && (
        <div className="absolute inset-0 bg-blue-400 opacity-10 animate-pulse rounded-lg" />
      )}
      <div className="flex justify-center mb-1">
        <span className={`w-2 h-2 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
      </div>
      <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">{step.stepCode}</div>
      <div className="text-xs mt-1 text-gray-600 leading-tight">{step.stepName}</div>
      <div className={`text-xs mt-1.5 font-semibold ${cfg.text}`}>{step.status}</div>
      {step.durationMs != null && step.status === 'DONE' && (
        <div className="text-xs text-gray-400 mt-0.5">{fmtDuration(step.durationMs)}</div>
      )}
      {step.errorMessage && (
        <div className="text-xs text-red-600 mt-1 leading-tight">{step.errorMessage}</div>
      )}
      {(step.retryCount ?? 0) > 0 && (
        <div className="text-xs text-orange-500 mt-0.5">↺ {step.retryCount}</div>
      )}
    </div>
  );
}

function ProgressBar({ steps }: { steps: CloseStep[] }) {
  const done = steps.filter(s => s.status === 'DONE').length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-500">
        <span>{done} of {total} steps complete</span>
        <span className="font-semibold">{pct}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Live Close Monitor ───────────────────────────────────────────────────────

function LiveCloseMonitor({ closeId }: { closeId: string }) {
  const { data: close, error } = useQuery<CloseRecord>({
    queryKey: ['eom-close', closeId],
    queryFn: () => eomApi.getCloseById(closeId),
    refetchInterval: (query) => {
      const data = query.state.data as CloseRecord | undefined;
      return data?.status === 'IN_PROGRESS' ? 2_000 : false;
    },
    staleTime: 0,
  });

  if (error) return (
    <div className="text-sm text-red-600 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
      {(error as Error).message}
    </div>
  );

  if (!close) return (
    <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
      <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      Loading close progress…
    </div>
  );

  const statusConfig = {
    NOT_STARTED: { color: 'text-gray-600', bg: 'bg-gray-100', label: 'Not Started' },
    IN_PROGRESS: { color: 'text-blue-700', bg: 'bg-blue-100', label: 'In Progress' },
    COMPLETED: { color: 'text-green-700', bg: 'bg-green-100', label: 'Completed' },
    BLOCKED: { color: 'text-red-700', bg: 'bg-red-100', label: 'Blocked' },
  }[close.status] ?? { color: 'text-gray-600', bg: 'bg-gray-100', label: close.status };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold ${statusConfig.bg} ${statusConfig.color}`}>
          {close.status === 'IN_PROGRESS' && <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />}
          {statusConfig.label}
        </span>
        <span className="text-sm text-gray-500">{periodLabel(close.periodYear, close.periodMonth)}</span>
        {close.status === 'IN_PROGRESS' && (
          <span className="text-xs text-blue-500 font-medium">● Live — refreshing every 2s</span>
        )}
      </div>

      {close.steps.length > 0 && (
        <>
          <ProgressBar steps={close.steps} />
          <div className="flex gap-2 overflow-x-auto pb-1">
            {close.steps.map((step, i) => <StepCard key={step.stepCode} step={step} idx={i} />)}
          </div>
        </>
      )}

      {close.blockedReason && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          <strong>Blocked:</strong> {close.blockedReason}
        </div>
      )}

      {close.status === 'COMPLETED' && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
          <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Close completed at {close.completedAt ? new Date(close.completedAt).toLocaleString() : '—'}
        </div>
      )}
    </div>
  );
}

// ─── Schedule Purge Preview ───────────────────────────────────────────────────

function SchedulePurgePreview({ items }: { items: SchedulePurgeItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = items.reduce((s, i) => s + i.totalAmount, 0);
  const totalItems = items.reduce((s, i) => s + i.itemCount, 0);

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-amber-100/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          <span className="text-sm font-semibold text-amber-800">
            Schedule Purge Preview — {items.length} schedules ({totalItems} items, {fmtCurrency(total)})
          </span>
        </div>
        <svg className={`w-4 h-4 text-amber-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-amber-200">
          <table className="w-full text-sm">
            <thead className="bg-amber-100/70">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-amber-700 uppercase">Schedule</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-amber-700 uppercase">Description</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-amber-700 uppercase">Items</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-amber-700 uppercase">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {items.map(item => (
                <tr key={item.scheduleId} className="hover:bg-amber-50">
                  <td className="px-4 py-2 font-mono text-xs font-medium text-amber-900">{item.scheduleId}</td>
                  <td className="px-4 py-2 text-amber-800">{item.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-amber-700">{item.itemCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-amber-900">{fmtCurrency(item.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-amber-100/70">
              <tr>
                <td colSpan={2} className="px-4 py-2 text-xs font-semibold text-amber-700 uppercase">Total</td>
                <td className="px-4 py-2 text-right tabular-nums font-bold text-amber-900">{totalItems}</td>
                <td className="px-4 py-2 text-right tabular-nums font-bold text-amber-900">{fmtCurrency(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EOMCloseDashboard() {
  const queryClient = useQueryClient();
  const [activeCloseId, setActiveCloseId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);

  const { data: preview, isLoading: previewLoading, error: previewError, refetch: refetchPreview } = useQuery<PreviewData>({
    queryKey: ['eom-preview'],
    queryFn: () => eomApi.getPreview(),
    staleTime: 60_000,
  });

  const closeMut = useMutation({
    mutationFn: () => eomApi.close(year, month),
    onSuccess: (data: any) => {
      setActiveCloseId(data?.id ?? data?.closeId ?? null);
      setConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ['eom-preview'] });
    },
  });

  const conditions: ReadinessCondition[] = preview?.readiness ?? [];
  const hasBlocking = conditions.some(c => c.severity === 'BLOCKING');
  const schedulesToPurge: SchedulePurgeItem[] = preview?.schedulesToPurge ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">EOM Close Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            End-of-month close readiness, initiation, and live step progress
          </p>
        </div>
      </div>

      {/* Period Selector */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-6">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Period</label>
            <div className="flex items-center gap-2">
              <select value={month} onChange={e => setMonth(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <select value={year} onChange={e => setYear(Number(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {[now.getFullYear() - 1, now.getFullYear()].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {preview?.estimatedDuration && (
            <div className="text-sm text-gray-500 mt-4">
              Estimated duration: <span className="font-semibold text-gray-700">{fmtDuration(preview.estimatedDuration)}</span>
            </div>
          )}

          <div className="ml-auto mt-4">
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={hasBlocking || closeMut.isPending}
              className={`px-6 py-2.5 text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors ${
                hasBlocking
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
              }`}
            >
              {closeMut.isPending && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Initiate Close — {periodLabel(year, month)}
            </button>
            {hasBlocking && (
              <p className="text-xs text-red-600 mt-1 text-right">Resolve blocking issues first</p>
            )}
          </div>
        </div>
      </div>

      {/* Readiness Check */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-gray-800">Readiness Check</h2>
          <button onClick={() => refetchPreview()}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {previewLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
            <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            Checking readiness…
          </div>
        ) : previewError ? (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {(previewError as Error).message}
            <button onClick={() => refetchPreview()} className="ml-2 underline">Retry</button>
          </div>
        ) : (
          <ReadinessPanel conditions={conditions} />
        )}
      </div>

      {/* Schedule Purge Preview */}
      {schedulesToPurge.length > 0 && (
        <SchedulePurgePreview items={schedulesToPurge} />
      )}

      {/* Live Close Monitor */}
      {activeCloseId && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
          <h2 className="text-base font-bold text-gray-800">Close Progress</h2>
          <LiveCloseMonitor closeId={activeCloseId} />
        </div>
      )}

      {/* Mutation error */}
      {closeMut.isError && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <strong>Error initiating close:</strong> {(closeMut.error as Error).message}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">Confirm EOM Close</h3>
                <p className="text-sm text-gray-600 mt-1">
                  You are about to initiate the end-of-month close for{' '}
                  <strong>{periodLabel(year, month)}</strong>.
                  This action will lock the period and cannot be undone.
                </p>
              </div>
            </div>

            {conditions.filter(c => c.severity === 'WARNING').length > 0 && (
              <div className="px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
                ⚠ {conditions.filter(c => c.severity === 'WARNING').length} warning{conditions.filter(c => c.severity === 'WARNING').length > 1 ? 's' : ''} exist.
                Proceeding anyway.
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirmOpen(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => closeMut.mutate()} disabled={closeMut.isPending}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {closeMut.isPending && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Confirm & Initiate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { postingRecoveryApi } from '../../api/client';
import { EmptyState, ErrorState, LoadingState, UnauthorizedState } from '../../components/report';
import { Badge } from '../../components/ui';

interface QueueItem {
  id: string;
  sourceEventType: string;
  sourceSystem: string;
  sourceTransactionId: string | null;
  status: string;
  latestFailureCategory: string;
  latestFailureCode: string;
  latestFailureMessage?: string;
  firstFailureAt: string;
  latestFailureAt: string;
  lastAttemptAt?: string | null;
  attemptCount: number;
  assignedOwner: string | null;
  escalationState: string | null;
}

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple'> = {
  QUARANTINED: 'danger',
  UNDER_REVIEW: 'warning',
  AWAITING_CORRECTION: 'warning',
  READY_FOR_REPLAY: 'info',
  REPLAY_IN_PROGRESS: 'info',
  RESOLVED: 'success',
  ESCALATED: 'purple',
  DISPOSITIONED: 'neutral',
};

const PAGE_SIZE = 25;

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PostingRecoveryQueue() {
  const { isAuthenticated } = useAuth();

  const [status, setStatus] = useState('');
  const [failureCategory, setFailureCategory] = useState('');
  const [sourceSystem, setSourceSystem] = useState('');
  const [eventType, setEventType] = useState('');
  const [assignedOwner, setAssignedOwner] = useState('');
  const [failureDateFrom, setFailureDateFrom] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{ byStatus: Record<string, number>; byFailureCategory: Record<string, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);

  const buildParams = useCallback((forPage: number) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (failureCategory) params.set('failureCategory', failureCategory);
    if (sourceSystem) params.set('sourceSystem', sourceSystem);
    if (eventType) params.set('eventType', eventType);
    if (assignedOwner) params.set('assignedOwner', assignedOwner);
    if (failureDateFrom) params.set('failureDateFrom', failureDateFrom);
    if (search) params.set('search', search);
    params.set('page', String(forPage));
    params.set('pageSize', String(PAGE_SIZE));
    return params.toString();
  }, [status, failureCategory, sourceSystem, eventType, assignedOwner, failureDateFrom, search]);

  const load = useCallback(async (forPage = 1) => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    setUnauthorized(null);
    try {
      const [queue, summaryResult] = await Promise.all([
        postingRecoveryApi.listQueue(buildParams(forPage)),
        postingRecoveryApi.getSummary().catch(() => null),
      ]);
      setItems(queue.items as QueueItem[]);
      setTotal(queue.total);
      setPage(forPage);
      if (summaryResult) setSummary(summaryResult);
    } catch (err: any) {
      if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
      else setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, buildParams]);

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, failureCategory, sourceSystem, eventType, assignedOwner, failureDateFrom, search]);

  if (!isAuthenticated) {
    return (
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <p className="text-slate-600">Sign in to view Posting Recovery.</p>
        <Link to="/login" className="text-[#0B5CAB] hover:underline">Sign in</Link>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6" data-testid="posting-recovery-queue">
      <h1 className="text-xl font-semibold text-slate-900">Posting Recovery</h1>
      <p className="text-[13px] text-slate-500 mt-1 max-w-[720px]">
        Inspect accounting-posting events that failed and landed in the dead-letter queue. This is a
        read-only workbench — it does not post to the general ledger and does not replay events.
      </p>

      {unauthorized ? (
        <UnauthorizedState testId="prq-unauthorized" message={unauthorized} />
      ) : (
        <>
          {summary && (
            <div className="mt-4 flex flex-wrap gap-4" data-testid="prq-summary">
              <div className="border border-slate-200 rounded-md px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">By status</div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {Object.entries(summary.byStatus).map(([k, v]) => (
                    <Badge key={k} variant={STATUS_VARIANT[k] ?? 'neutral'}>{k} ({v})</Badge>
                  ))}
                </div>
              </div>
              <div className="border border-slate-200 rounded-md px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">By failure category</div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {Object.entries(summary.byFailureCategory).map(([k, v]) => (
                    <Badge key={k} variant="neutral">{k} ({v})</Badge>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-3" data-testid="prq-filters">
            <label className="text-[12px] text-slate-600">
              Search
              <input
                data-testid="prq-filter-search"
                className="block mt-1 h-8 border border-slate-300 rounded px-2 text-[13px] w-48"
                placeholder="event, correlation, txn id"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="text-[12px] text-slate-600">
              Status
              <select data-testid="prq-filter-status" className="block mt-1 h-8 border border-slate-300 rounded px-2 text-[13px]" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option>
                {['QUARANTINED', 'UNDER_REVIEW', 'AWAITING_CORRECTION', 'READY_FOR_REPLAY', 'REPLAY_IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'DISPOSITIONED'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Failure category
              <select data-testid="prq-filter-category" className="block mt-1 h-8 border border-slate-300 rounded px-2 text-[13px]" value={failureCategory} onChange={(e) => setFailureCategory(e.target.value)}>
                <option value="">All</option>
                {['EVENT_CONTRACT_INVALID', 'RULE_NOT_FOUND', 'RULE_CONFIGURATION_INVALID', 'ACCOUNTING_MAPPING_UNRESOLVED', 'REFERENCE_DATA_MISSING', 'ACCOUNTING_PERIOD_BLOCKED', 'SOURCE_STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'AUTHORIZATION_FAILURE', 'DOWNSTREAM_TRANSIENT', 'DOWNSTREAM_PERMANENT', 'INFRASTRUCTURE_FAILURE', 'UNKNOWN_FAILURE'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-slate-600">
              Source service
              <input data-testid="prq-filter-source" className="block mt-1 h-8 border border-slate-300 rounded px-2 text-[13px] w-36" value={sourceSystem} onChange={(e) => setSourceSystem(e.target.value)} />
            </label>
            <label className="text-[12px] text-slate-600">
              Event type
              <input data-testid="prq-filter-event-type" className="block mt-1 h-8 border border-slate-300 rounded px-2 text-[13px] w-36" value={eventType} onChange={(e) => setEventType(e.target.value)} />
            </label>
            <label className="text-[12px] text-slate-600">
              Owner
              <input data-testid="prq-filter-owner" className="block mt-1 h-8 border border-slate-300 rounded px-2 text-[13px] w-32" value={assignedOwner} onChange={(e) => setAssignedOwner(e.target.value)} />
            </label>
            <label className="text-[12px] text-slate-600">
              Failed on/after
              <input type="date" data-testid="prq-filter-date" className="block mt-1 h-8 border border-slate-300 rounded px-2 text-[13px]" value={failureDateFrom} onChange={(e) => setFailureDateFrom(e.target.value)} />
            </label>
          </div>

          {loading && <LoadingState label="Loading posting recovery queue…" testId="prq-loading" rows={8} cols={9} />}

          {!loading && error && <ErrorState message={error} testId="prq-error" onRetry={() => load(page)} />}

          {!loading && !error && items.length === 0 && (
            <EmptyState title="No failed events" message="No dead-letter cases match the current filters." testId="prq-empty" />
          )}

          {!loading && !error && items.length > 0 && (
            <>
              <div className="mt-4 overflow-x-auto border border-slate-200 rounded-md" data-testid="prq-table">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 h-9">Case ID</th>
                      <th className="px-3 h-9">Event Type</th>
                      <th className="px-3 h-9">Source Service</th>
                      <th className="px-3 h-9">Source Txn</th>
                      <th className="px-3 h-9">Failure Category</th>
                      <th className="px-3 h-9">Failure Summary</th>
                      <th className="px-3 h-9">Status</th>
                      <th className="px-3 h-9">First Failure</th>
                      <th className="px-3 h-9">Latest Attempt</th>
                      <th className="px-3 h-9 text-right">Attempts</th>
                      <th className="px-3 h-9">Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="h-9 border-t border-slate-100 hover:bg-slate-50" data-testid={`prq-row-${item.id}`}>
                        <td className="px-3">
                          <Link to={`/accounting/gl/posting-recovery/${item.id}`} className="text-[#0B5CAB] hover:underline font-mono text-[12px]">
                            {item.id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="px-3">{item.sourceEventType}</td>
                        <td className="px-3">{item.sourceSystem}</td>
                        <td className="px-3 font-mono text-[12px]">{item.sourceTransactionId ?? '—'}</td>
                        <td className="px-3"><Badge variant="neutral">{item.latestFailureCategory}</Badge></td>
                        <td className="px-3 max-w-[260px] truncate" title={item.latestFailureMessage}>{item.latestFailureMessage ?? item.latestFailureCode}</td>
                        <td className="px-3"><Badge variant={STATUS_VARIANT[item.status] ?? 'neutral'}>{item.status}</Badge></td>
                        <td className="px-3 whitespace-nowrap">{formatDateTime(item.firstFailureAt)}</td>
                        <td className="px-3 whitespace-nowrap">{formatDateTime(item.lastAttemptAt)}</td>
                        <td className="px-3 text-right font-mono">{item.attemptCount}</td>
                        <td className="px-3">{item.assignedOwner ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex items-center justify-between text-[12px] text-slate-500">
                <span>{total} case{total === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-2">
                  <button
                    data-testid="prq-page-prev"
                    className="h-7 px-2 border border-slate-300 rounded disabled:opacity-40"
                    disabled={page <= 1}
                    onClick={() => load(page - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {page} of {totalPages}</span>
                  <button
                    data-testid="prq-page-next"
                    className="h-7 px-2 border border-slate-300 rounded disabled:opacity-40"
                    disabled={page >= totalPages}
                    onClick={() => load(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { taxApi, type TaxAuditEntry } from '../../api/client';
import { LoadingState, ErrorState, EmptyState, UnauthorizedState } from '../report';

// CE-10 — one reusable "Effective-Date History" tab (who/when/what
// before->after), read-only, backed by the shared
// GET /api/v1/tax/audit/:entityType/:entityId endpoint. Used by every
// config surface this epic introduces (jurisdictions, exemptions, fees,
// adapter config) so the audit-trail rendering/behavior is identical
// everywhere per the Fable package's "history tab pattern on every config
// surface" instruction.
export function EffectiveDateHistoryTab({ entityType, entityId, testId = 'tax-history-tab' }: {
  entityType: string;
  entityId: string;
  testId?: string;
}) {
  const [items, setItems] = useState<TaxAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUnauthorized(null);
    taxApi.getAuditTrail(entityType, entityId)
      .then((res) => { if (!cancelled) setItems(res.items); })
      .catch((err: any) => {
        if (cancelled) return;
        if (err.status === 401 || err.status === 403) setUnauthorized(err.message);
        else setError(err.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  if (loading) return <LoadingState testId={`${testId}-loading`} label="Loading history…" rows={3} cols={4} />;
  if (unauthorized) return <UnauthorizedState testId={`${testId}-unauthorized`} message={unauthorized} />;
  if (error) return <ErrorState testId={`${testId}-error`} message={error} />;
  if (!items || items.length === 0) {
    return <EmptyState testId={`${testId}-empty`} title="No history yet" message="No configuration changes have been recorded for this item." />;
  }

  return (
    <div data-testid={testId} className="flex flex-col gap-3">
      {items.map((entry) => (
        <div key={entry.id} data-testid={`${testId}-entry-${entry.id}`} className="border border-slate-200 rounded-md p-3 text-[12.5px]">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-900">{entry.action}</span>
            <span className="text-slate-400">{entry.createdAt}</span>
          </div>
          <div className="text-slate-500 mt-0.5">by {entry.actor}</div>
          {(entry.before || entry.after) && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Before</div>
                <pre className="text-[11px] whitespace-pre-wrap break-words text-slate-600">{entry.before ? JSON.stringify(entry.before, null, 2) : '—'}</pre>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">After</div>
                <pre className="text-[11px] whitespace-pre-wrap break-words text-slate-600">{entry.after ? JSON.stringify(entry.after, null, 2) : '—'}</pre>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// CE-11 mandatory UI screen #12 — "history-tab pattern on every aggregate".
// Reads fixedops-service's local AuditOutboxEvent trail (written
// in-transaction with every material action) for a single doc, or globally
// when no docType/docId is pinned.
import { useQuery } from '@tanstack/react-query';
import { fixedopsApi, type AuditEvent } from '../../../api/fixedopsApi';
import { LoadingState, ErrorState, EmptyState } from '../../../components/report';

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function AuditHistoryTab({ docType, docId, testId = 'fixedops-audit-history' }: { docType: string; docId: string; testId?: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fixedops-audit', docType, docId],
    queryFn: () => fixedopsApi.auditTrail(docType, docId),
    enabled: !!docType && !!docId,
  });

  if (isLoading) return <LoadingState testId={`${testId}-loading`} label="Loading audit history…" />;
  if (error) return <ErrorState testId={`${testId}-error`} message={(error as Error).message} onRetry={() => refetch()} />;

  const items: AuditEvent[] = data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState testId={`${testId}-empty`} title="No audit events" message="No recorded actions for this record yet." />;
  }

  return (
    <div className="flex flex-col gap-2 p-3" data-testid={testId}>
      {items.map((ev) => (
        <div key={ev.id} className="border border-gray-200 rounded p-2 text-xs bg-white" data-testid={`${testId}-row-${ev.id}`}>
          <div className="flex items-center justify-between">
            <span className="font-semibold text-gray-800">{ev.action}</span>
            <span className="text-gray-400 font-mono">{fmtDateTime(ev.createdAt)}</span>
          </div>
          <div className="text-gray-500 mt-0.5">
            by <span className="font-mono">{ev.actor}</span>
            {ev.correlationId && <> · correlation <span className="font-mono">{ev.correlationId}</span></>}
          </div>
          {ev.reason && <div className="text-gray-600 mt-1 italic">"{ev.reason}"</div>}
        </div>
      ))}
    </div>
  );
}

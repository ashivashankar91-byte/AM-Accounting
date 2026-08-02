// CE-11 mandatory UI screen #11 — Exception & Recovery Queue.
// /accounting/fixedops/exceptions — Accountant persona.
// ONE worklist combining fixedops-service's S021-aligned exceptions (tax
// blocks, mapping-pending, rule-not-found) AND parts-accounting-service's
// exceptions (negative-on-hand, mapping-pending). Calls parts-accounting
// directly via the shared apiFetch helper rather than importing the
// sibling fork's partsApi.ts module, to avoid a cross-fork file dependency.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fixedopsApi, rawApiFetch, type FixedOpsException } from '../../../api/fixedopsApi';
import { PageHeader, Btn } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState, UnauthorizedState } from '../../../components/report';

interface MergedException extends FixedOpsException {
  source: 'Service' | 'Parts';
}

function fetchPartsExceptions(): Promise<{ items: FixedOpsException[] }> {
  return rawApiFetch<{ items: FixedOpsException[] }>('/api/v1/parts-accounting/exceptions');
}

export default function FixedOpsExceptionQueue() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('OPEN');
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const fixedopsQuery = useQuery({
    queryKey: ['fixedops-exceptions', status],
    queryFn: () => fixedopsApi.listExceptions({ status: status || undefined }),
  });
  const partsQuery = useQuery({
    queryKey: ['parts-exceptions-via-fixedops-screen', status],
    queryFn: fetchPartsExceptions,
  });

  const isLoading = fixedopsQuery.isLoading || partsQuery.isLoading;
  const error = fixedopsQuery.error ?? partsQuery.error;
  const unauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;

  const merged: MergedException[] = useMemo(() => {
    const fromFixedOps = (fixedopsQuery.data?.items ?? []).map((e) => ({ ...e, source: 'Service' as const }));
    const fromParts = (partsQuery.data?.items ?? [])
      .filter((e: any) => !status || e.status === status)
      .map((e: any) => ({ ...e, source: 'Parts' as const }));
    return [...fromFixedOps, ...fromParts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [fixedopsQuery.data, partsQuery.data, status]);

  async function resolve(item: MergedException) {
    setRowBusy(item.id);
    setRowError(null);
    try {
      if (item.source === 'Service') {
        await fixedopsApi.resolveException(item.id);
      } else {
        await rawApiFetch(`/api/v1/parts-accounting/exceptions/${encodeURIComponent(item.id)}/resolve`, { method: 'POST' });
      }
      await qc.invalidateQueries({ queryKey: ['fixedops-exceptions'] });
      await qc.invalidateQueries({ queryKey: ['parts-exceptions-via-fixedops-screen'] });
    } catch (err: any) {
      setRowError({ id: item.id, message: err.message });
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div className="p-4">
      <PageHeader
        title="Exception &amp; Recovery Queue"
        subtitle="One worklist for CE-11 S021-aligned cases: tax-blocked transactions, mapping-pending rejections, negative-on-hand exceptions, and unmatched sublet — across both Fixed Ops and Parts."
      />

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs font-medium text-gray-600">Status:</label>
        <select className="h-8 border border-gray-300 rounded px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="fixedops-exceptions-status-filter">
          <option value="">All</option>
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
          <option value="REPLAYED">Replayed</option>
        </select>
        <Btn size="sm" variant="secondary" onClick={() => { fixedopsQuery.refetch(); partsQuery.refetch(); }} data-testid="fixedops-exceptions-refresh">Refresh</Btn>
      </div>

      {isLoading && <LoadingState testId="fixedops-exceptions-loading" label="Loading exceptions…" />}
      {error && !unauthorized && <ErrorState testId="fixedops-exceptions-error" message={(error as Error).message} onRetry={() => { fixedopsQuery.refetch(); partsQuery.refetch(); }} />}
      {unauthorized && <UnauthorizedState testId="fixedops-exceptions-unauthorized" message="You do not have permission to view the exception queue." />}

      {!isLoading && !error && merged.length === 0 && (
        <EmptyState testId="fixedops-exceptions-empty" title="No exceptions — engine healthy." />
      )}

      {!isLoading && !error && merged.length > 0 && (
        <table className="w-full border-collapse bg-white border border-gray-200 rounded" data-testid="fixedops-exceptions-table">
          <thead>
            <tr className="bg-gray-50 text-gray-600 uppercase tracking-wide text-[11px]">
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">RO#/Part#</th>
              <th className="text-left px-3 py-2">Reason</th>
              <th className="text-left px-3 py-2">Detail</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Raised</th>
              <th className="text-left px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {merged.map((item) => (
              <tr key={`${item.source}-${item.id}`} className="h-10 border-b border-gray-100 hover:bg-gray-50" data-testid={`fixedops-exception-row-${item.id}`}>
                <td className="px-3"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${item.source === 'Service' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{item.source}</span></td>
                <td className="px-3 font-mono text-xs">{item.roNumber ?? (item as any).partNumber ?? '—'}</td>
                <td className="px-3"><StatusBadge status={item.reasonCode} /></td>
                <td className="px-3 text-xs">{item.detail ?? '—'}</td>
                <td className="px-3"><StatusBadge status={item.status} /></td>
                <td className="px-3 text-xs">{new Date(item.createdAt).toLocaleString()}</td>
                <td className="px-3">
                  {item.status === 'OPEN' && (
                    <Btn size="sm" variant="secondary" onClick={() => resolve(item)} loading={rowBusy === item.id} data-testid={`fixedops-exception-resolve-${item.id}`}>
                      Resolve / re-request
                    </Btn>
                  )}
                  {rowError?.id === item.id && <p className="text-[11px] text-red-600 mt-1">{rowError.message}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

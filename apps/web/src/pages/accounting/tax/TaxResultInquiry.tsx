import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taxApi } from '../../../api/client';
import { PageHeader } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { EmptyState, Drawer, DrawerRow, FilterBar, FilterField, FILTER_CONTROL_CLASS, ErrorState } from '../../../components/report';

// CE-10 / S124 — Calculation / Result Inquiry. Searchable, immutable result
// store. READ ONLY — no edit/delete affordance anywhere on this screen; a
// stored TaxCalculationResult is evidence, recalculation always creates a
// new linked result rather than editing this one. Permission: tax.result.view.
export default function TaxResultInquiry() {
  const [documentRef, setDocumentRef] = useState('');
  const [entityId, setEntityId] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [status, setStatus] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tax-results', documentRef, entityId, jurisdiction, status],
    queryFn: () => taxApi.listResults({
      documentRef: documentRef || undefined,
      entityId: entityId || undefined,
      jurisdiction: jurisdiction || undefined,
      status: status || undefined,
    }),
    retry: false,
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  const {
    data: detail, isLoading: detailLoading, error: detailError,
  } = useQuery({
    queryKey: ['tax-result-detail', selectedId],
    queryFn: () => taxApi.getResult(selectedId as string),
    enabled: selectedId !== null,
    retry: false,
  });

  if (isLoading) return <PageLoader page="Calculation / Result Inquiry" service="tax-service" port={3040} />;

  if (error) {
    const st = (error as any)?.status;
    if (st === 401 || st === 403) {
      return (
        <div className="p-7">
          <EmptyState
            testId="tax-results-unauthorized"
            title="Unauthorized"
            message="You do not have the tax.result.view permission required to view Calculation / Result Inquiry. Contact your Controller or Admin."
          />
        </div>
      );
    }
    return <PageError error={error as Error} serviceName="tax-service" port={3040} retry={() => refetch()} />;
  }

  return (
    <div className="p-7 min-h-full" data-testid="tax-results-page">
      <PageHeader
        title="Calculation / Result Inquiry"
        subtitle="Searchable, immutable tax result store — evidence of every calculation attempt. No edit or delete actions exist on this screen."
      />

      <FilterBar>
        <FilterField label="Document ref" width={180}>
          <input className={FILTER_CONTROL_CLASS} value={documentRef} onChange={(e) => setDocumentRef(e.target.value)} data-testid="tax-results-filter-document" />
        </FilterField>
        <FilterField label="Legal entity" width={180}>
          <input className={FILTER_CONTROL_CLASS} value={entityId} onChange={(e) => setEntityId(e.target.value)} data-testid="tax-results-filter-entity" />
        </FilterField>
        <FilterField label="Jurisdiction" width={160}>
          <input className={FILTER_CONTROL_CLASS} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} data-testid="tax-results-filter-jurisdiction" />
        </FilterField>
        <FilterField label="Status" width={160}>
          <select className={FILTER_CONTROL_CLASS} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="tax-results-filter-status">
            <option value="">All</option>
            <option value="CALCULATED">Calculated</option>
            <option value="EXEMPT_APPLIED">Exempt applied</option>
            <option value="ENGINE_UNAVAILABLE">Engine unavailable</option>
            <option value="ENGINE_REJECTED">Engine rejected</option>
            <option value="NOT_CONFIGURED">Not configured</option>
          </select>
        </FilterField>
      </FilterBar>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        {rows.length === 0 ? (
          <EmptyState testId="tax-results-empty" title="No calculation results found" message="No results match this search — try widening the filters." />
        ) : (
          <table className="w-full border-collapse" data-testid="tax-result-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Document</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Date</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Entity</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Jurisdictions</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  data-testid={`tax-result-row-${r.id}`}
                  className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => setSelectedId(r.id)}
                >
                  <td className="px-4 py-0 font-mono text-[13px] text-slate-800">{r.documentRef}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.documentDate}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.legalEntityId}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{(r.jurisdictions ?? []).join(', ')}</td>
                  <td className="px-4 py-0"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Drawer
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
        title={`Result detail — ${detail?.documentRef ?? ''}`}
        subtitle="Immutable — no edit actions"
        testId="tax-result-drawer"
      >
        {detailLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {detailError && <ErrorState testId="tax-result-detail-error" message={(detailError as Error).message} />}
        {detail && (
          <div data-testid="tax-result-detail-content">
            <DrawerRow label="Status" value={<StatusBadge status={detail.status} />} />
            <DrawerRow label="Engine version" value={detail.engineVersion ?? '—'} />
            <DrawerRow label="Content version" value={detail.contentVersion ?? '—'} />
            <DrawerRow label="Calculated at" value={detail.calculatedAt} />
            {detail.linkedJournalId ? (
              <DrawerRow label="Linked journal" value={<span data-testid="tax-result-linked-journal">{detail.linkedJournalId}</span>} />
            ) : detail.unpostedAging ? (
              <DrawerRow label="Posting status" value={<span data-testid="tax-result-unposted-aging">Unposted — {detail.unpostedAging.days} day(s) aging</span>} />
            ) : (
              <DrawerRow label="Posting status" value="—" />
            )}

            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Per-line jurisdiction breakdown (as returned)</div>
              {detail.lines.length === 0 ? (
                <p className="text-xs text-slate-400">No lines returned.</p>
              ) : (
                <table className="w-full border-collapse text-[12px]" data-testid="tax-result-lines-table">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-slate-500">
                      <th className="py-1">Jurisdiction</th>
                      <th className="py-1">Tax type</th>
                      <th className="py-1 text-right">Rate</th>
                      <th className="py-1 text-right">Taxable base</th>
                      <th className="py-1 text-right">Tax amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.lineId} className="border-b border-slate-100">
                        <td className="py-1">{l.jurisdictionId} ({l.jurisdictionLevel})</td>
                        <td className="py-1">{l.taxType}</td>
                        <td className="py-1 text-right font-mono">{l.rateAsReturned}</td>
                        <td className="py-1 text-right font-mono">{l.taxableBase}</td>
                        <td className="py-1 text-right font-mono">{l.taxAmount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Request snapshot</div>
              <pre className="text-[11px] whitespace-pre-wrap break-words text-slate-600" data-testid="tax-result-request-snapshot">
                {JSON.stringify(detail.requestSnapshot, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

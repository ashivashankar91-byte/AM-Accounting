import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { taxApi, type TaxException } from '../../../api/client';
import { PageHeader, Btn } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { EmptyState, Drawer, Banner } from '../../../components/report';
import { EffectiveDateHistoryTab } from '../../../components/tax/EffectiveDateHistoryTab';

// CE-10 / S124 — Exception & Outage Queue. Parked transactions (nothing
// posts, nothing is estimated) with a reason, single + bulk re-request
// recovery, and disposition history. Permissions: tax.exception.view /
// tax.exception.disposition.
export default function TaxExceptionQueue() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historyRow, setHistoryRow] = useState<TaxException | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<{ id: string; message: string } | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tax-exceptions'],
    queryFn: () => taxApi.listExceptions(),
    retry: false,
  });

  const rows = useMemo(() => data?.items ?? [], [data]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tax-exceptions'] });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function reRequestOne(id: string) {
    setRowBusy(id);
    setRowMessage(null);
    try {
      await taxApi.reRequestException(id);
      await refresh();
    } catch (err: any) {
      setRowMessage({ id, message: err.message });
    } finally {
      setRowBusy(null);
    }
  }

  async function reRequestBulk() {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setBulkResult(null);
    setBulkError(null);
    try {
      const result = await taxApi.bulkReRequestExceptions(Array.from(selected));
      setBulkResult(`Re-requested ${result.results.length} exception(s).`);
      setSelected(new Set());
      await refresh();
    } catch (err: any) {
      setBulkError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  if (isLoading) return <PageLoader page="Tax Exception & Outage Queue" service="tax-service" port={3040} />;

  if (error) {
    const st = (error as any)?.status;
    if (st === 401 || st === 403) {
      return (
        <div className="p-7">
          <EmptyState
            testId="tax-exceptions-unauthorized"
            title="Unauthorized"
            message="You do not have the tax.exception.view permission required to view the Tax Exception & Outage Queue. Contact your Controller or Admin."
          />
        </div>
      );
    }
    return <PageError error={error as Error} serviceName="tax-service" port={3040} retry={() => refetch()} />;
  }

  return (
    <div className="p-7 min-h-full" data-testid="tax-exceptions-page">
      <PageHeader
        title="Tax Exception & Outage Queue"
        subtitle="Parked transactions where an authoritative tax result was unavailable — never estimated. Re-request resumes the source transaction's normal flow."
        actions={
          <Btn
            variant="primary"
            size="md"
            icon={<RefreshCw size={14} />}
            onClick={reRequestBulk}
            disabled={selected.size === 0}
            loading={bulkBusy}
            data-testid="tax-exception-bulk-re-request"
          >
            Re-request selected ({selected.size})
          </Btn>
        }
      />

      {bulkResult && <Banner kind="success" testId="tax-exception-bulk-result" title="Bulk re-request complete">{bulkResult}</Banner>}
      {bulkError && <Banner kind="error" testId="tax-exception-bulk-error" title="Bulk re-request failed">{bulkError}</Banner>}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-5">
        {rows.length === 0 ? (
          <EmptyState testId="tax-exceptions-empty" title="No tax exceptions — engine healthy." />
        ) : (
          <table className="w-full border-collapse" data-testid="tax-exception-table">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600 w-8"></th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Document</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Reason</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Detail</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Parked at</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`tax-exception-row-${r.id}`} className="h-9 border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-0">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} data-testid={`tax-exception-select-${r.id}`} />
                  </td>
                  <td className="px-4 py-0 font-mono text-[13px] text-slate-800">{r.documentRef}</td>
                  <td className="px-4 py-0"><StatusBadge status={r.reasonCode} /></td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.reasonDetail ?? '—'}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.parkedAt}</td>
                  <td className="px-4 py-0 text-[13px] text-slate-700">{r.status}</td>
                  <td className="px-4 py-0">
                    <div className="flex items-center gap-2">
                      <Btn variant="secondary" size="sm" onClick={() => reRequestOne(r.id)} loading={rowBusy === r.id} data-testid={`tax-exception-re-request-${r.id}`}>
                        Re-request
                      </Btn>
                      <Btn variant="secondary" size="sm" onClick={() => setHistoryRow(r)} data-testid={`tax-exception-history-${r.id}`}>History</Btn>
                    </div>
                    {rowMessage?.id === r.id && <p className="text-xs text-red-600 mt-1" data-testid={`tax-exception-error-${r.id}`}>{rowMessage.message}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Drawer
        open={historyRow !== null}
        onClose={() => setHistoryRow(null)}
        title={`Disposition history — ${historyRow?.documentRef ?? ''}`}
        testId="tax-exception-history-drawer"
      >
        {historyRow && <EffectiveDateHistoryTab entityType="tax_exception" entityId={historyRow.id} testId="tax-exception-history-tab" />}
      </Drawer>
    </div>
  );
}

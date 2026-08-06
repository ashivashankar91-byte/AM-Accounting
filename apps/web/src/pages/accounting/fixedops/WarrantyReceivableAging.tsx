// CE-11 mandatory UI screen #4 — Warranty Receivable & Claim Aging.
// /accounting/fixedops/warranty — Warranty admin/Controller persona.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fixedopsApi, type WarrantyClaimItem } from '../../../api/fixedopsApi';
import {
  FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, TotalsRow,
  EmptyState, ErrorState, LoadingState, UnauthorizedState, Drawer,
} from '../../../components/report';
import { Btn, Badge, MoneyCell, PageHeader } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';

function DispositionDrawer({ claim, onClose }: { claim: WarrantyClaimItem; onClose: () => void }) {
  const [type, setType] = useState<'WRITE_DOWN' | 'TRANSFER_TO_CUSTOMER_RESPONSIBILITY' | 'DENIAL' | 'ADJUSTMENT'>('WRITE_DOWN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  async function submit() {
    if (!reason.trim()) { setError('A reason is required — dispositions are never silent.'); return; }
    setBusy(true); setError(null);
    try {
      await fixedopsApi.dispositionWarrantyClaim(claim.claimNumber, {
        type, amount, reason, sourceEventId: crypto.randomUUID(), correlationId: crypto.randomUUID(),
      });
      await qc.invalidateQueries({ queryKey: ['fixedops-warranty-aging'] });
      await qc.invalidateQueries({ queryKey: ['fixedops-warranty-list'] });
      onClose();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Drawer open onClose={onClose} title={`Disposition — ${claim.claimNumber}`} testId="warranty-disposition-drawer">
      <div className="p-3 flex flex-col gap-2">
        <div className="text-xs text-gray-500">Remaining: <MoneyCell value={claim.remainingAmount} /></div>
        <label className="text-xs font-medium text-gray-600">Type</label>
        <select className={FILTER_CONTROL_CLASS} value={type} onChange={(e) => setType(e.target.value as any)} data-testid="warranty-disposition-type">
          <option value="WRITE_DOWN">Write-down</option>
          <option value="TRANSFER_TO_CUSTOMER_RESPONSIBILITY">Transfer to customer responsibility</option>
          <option value="DENIAL">Denial</option>
          <option value="ADJUSTMENT">Adjustment / correction</option>
        </select>
        <label className="text-xs font-medium text-gray-600">Amount</label>
        <input className={FILTER_CONTROL_CLASS} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" data-testid="warranty-disposition-amount" />
        <label className="text-xs font-medium text-gray-600">Reason (required)</label>
        <textarea className={`${FILTER_CONTROL_CLASS} h-16`} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="warranty-disposition-reason" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 mt-2">
          <Btn size="sm" variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn size="sm" variant="danger" onClick={submit} loading={busy} data-testid="warranty-disposition-submit">Disposition</Btn>
        </div>
      </div>
    </Drawer>
  );
}

export default function WarrantyReceivableAging() {
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState('');
  const [dispositionTarget, setDispositionTarget] = useState<WarrantyClaimItem | null>(null);
  const qc = useQueryClient();

  const { data: agingData, isLoading, error, refetch } = useQuery({
    queryKey: ['fixedops-warranty-aging', storeId],
    queryFn: () => fixedopsApi.warrantyAging(storeId || undefined),
  });
  const { data: listData } = useQuery({
    queryKey: ['fixedops-warranty-list', storeId, status],
    queryFn: () => fixedopsApi.listWarrantyClaims({ storeId: storeId || undefined, status: status || undefined }),
  });

  const unauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;
  const rows = agingData?.rows ?? [];
  const listRows = listData?.items ?? [];

  const bandTotals: Record<string, number> = {};
  for (const r of rows) bandTotals[r.factoryAgeBand] = (bandTotals[r.factoryAgeBand] ?? 0) + Number(r.remainingAmount);

  async function submitClaim(claimNumber: string) {
    await fixedopsApi.submitWarrantyClaim(claimNumber);
    await qc.invalidateQueries({ queryKey: ['fixedops-warranty-list'] });
  }

  return (
    <div className="p-4">
      <PageHeader title="Warranty Receivable &amp; Claim Aging" subtitle="Claim items by factory age band, submit/remit lifecycle actions, short-pay/denial disposition ceremony." />

      <FilterBar>
        <FilterField label="Store" width={140}>
          <input className={FILTER_CONTROL_CLASS} value={storeId} onChange={(e) => setStoreId(e.target.value)} data-testid="warranty-store-filter" />
        </FilterField>
        <FilterField label="Status" width={200}>
          <select className={FILTER_CONTROL_CLASS} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="warranty-status-filter">
            <option value="">All</option>
            <option value="BORN">Born</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="PARTIALLY_REMITTED">Partially remitted</option>
            <option value="SHORT_PAY_DISPOSITIONED">Short-pay dispositioned</option>
            <option value="DENIED">Denied</option>
            <option value="CLOSED">Closed</option>
          </select>
        </FilterField>
        <Btn size="sm" onClick={() => refetch()} data-testid="warranty-refresh">Refresh</Btn>
      </FilterBar>

      {isLoading && <LoadingState testId="warranty-loading" label="Loading warranty claims…" />}
      {error && !unauthorized && <ErrorState testId="warranty-error" message={(error as Error).message} onRetry={() => refetch()} />}
      {unauthorized && <UnauthorizedState testId="warranty-unauthorized" message="You do not have permission to view warranty claims (fixedops.warranty.view)." />}

      {!isLoading && !error && rows.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap" data-testid="warranty-age-bands">
          {Object.entries(bandTotals).map(([band, total]) => (
            <div key={band} className="border border-gray-200 rounded p-2 bg-white flex-1 min-w-[120px]">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">{band}</div>
              <div className="font-mono text-sm font-semibold"><MoneyCell value={total} /></div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && listRows.length === 0 && (
        <EmptyState testId="warranty-empty" title="No warranty claims" message="No warranty-pay RO closes have created claim items for this scope." />
      )}

      {!isLoading && !error && listRows.length > 0 && (
        <FinancialTable testId="warranty-claims-table">
          <ReportThead>
            <tr>
              <ReportTh>Claim #</ReportTh>
              <ReportTh>RO#</ReportTh>
              <ReportTh>Status</ReportTh>
              <ReportTh align="right">Sale</ReportTh>
              <ReportTh align="right">Remaining</ReportTh>
              <ReportTh>Schedule effect</ReportTh>
              <ReportTh>Actions</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {listRows.map((c) => (
              <ReportTr key={c.id} testId={`warranty-claim-row-${c.claimNumber}`}>
                <ReportTd className="font-mono text-xs">{c.claimNumber}</ReportTd>
                <ReportTd><Link to={`/accounting/fixedops/ro/${encodeURIComponent(c.roNumber)}`} className="text-brand hover:underline font-mono">{c.roNumber}</Link></ReportTd>
                <ReportTd><StatusBadge status={c.status} /></ReportTd>
                <ReportTd align="right"><MoneyCell value={c.saleAmount} /></ReportTd>
                <ReportTd align="right"><MoneyCell value={c.remainingAmount} /></ReportTd>
                <ReportTd>{c.scheduleProjectionPending && <Badge variant="warning">projection pending</Badge>}</ReportTd>
                <ReportTd>
                  <div className="flex gap-1">
                    {c.status === 'BORN' && <Btn size="sm" variant="secondary" onClick={() => submitClaim(c.claimNumber)} data-testid={`warranty-submit-${c.claimNumber}`}>Submit</Btn>}
                    {(c.status === 'SUBMITTED' || c.status === 'PARTIALLY_REMITTED') && (
                      <Btn size="sm" variant="danger" onClick={() => setDispositionTarget(c)} data-testid={`warranty-disposition-open-${c.claimNumber}`}>Disposition</Btn>
                    )}
                  </div>
                </ReportTd>
              </ReportTr>
            ))}
          </tbody>
          <tfoot>
            <TotalsRow testId="warranty-total-remaining-row">
              <ReportTd colSpan={4}>Total remaining (aged, open items)</ReportTd>
              <ReportTd align="right"><MoneyCell value={agingData?.totalRemaining ?? 0} /></ReportTd>
              <ReportTd colSpan={2}> </ReportTd>
            </TotalsRow>
          </tfoot>
        </FinancialTable>
      )}

      {dispositionTarget && <DispositionDrawer claim={dispositionTarget} onClose={() => setDispositionTarget(null)} />}
    </div>
  );
}

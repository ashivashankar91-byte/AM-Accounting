// CE-11 mandatory UI screen #2 — RO Accounting Detail.
// /accounting/fixedops/ro/:roNumber — Accountant/Controller persona.
// Mixed-pay distribution tab (Σ-check conservation proof), journals tab
// (close/reversal/re-close chain), schedule-effects tab, audit tab.
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fixedopsApi, type RoCloseSubmission } from '../../../api/fixedopsApi';
import {
  FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, TotalsRow,
  Banner, EmptyState, ErrorState, LoadingState, UnauthorizedState,
} from '../../../components/report';
import { Btn, Badge, MoneyCell, PageHeader } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import { AuditHistoryTab } from './AuditHistoryTab';

function centsClose(a: number, b: number) {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) === 0;
}

function DistributionTab({ submission }: { submission: RoCloseSubmission }) {
  const sumSale = submission.lines.reduce((acc, l) => acc + Number(l.saleAmount), 0);
  const sumCost = submission.lines.reduce((acc, l) => acc + Number(l.costAmount), 0);
  const sumTax = submission.lines.reduce((acc, l) => acc + Number(l.taxAmount), 0);
  const total = Number(submission.totalSaleAmount);
  const conserves = centsClose(sumSale, total);

  return (
    <div>
      <FinancialTable testId="ro-distribution-table">
        <ReportThead>
          <tr>
            <ReportTh>Line</ReportTh>
            <ReportTh>Pay type</ReportTh>
            <ReportTh>Category</ReportTh>
            <ReportTh align="right">Sale</ReportTh>
            <ReportTh align="right">Cost</ReportTh>
            <ReportTh align="right">Tax</ReportTh>
          </tr>
        </ReportThead>
        <tbody>
          {submission.lines.map((l) => (
            <ReportTr key={l.id} testId={`ro-distribution-line-${l.lineId}`}>
              <ReportTd className="font-mono text-xs">{l.lineId}</ReportTd>
              <ReportTd><Badge variant={l.payType === 'C' ? 'info' : l.payType === 'W' ? 'warning' : 'neutral'}>{l.payType}</Badge></ReportTd>
              <ReportTd>{l.category}</ReportTd>
              <ReportTd align="right"><MoneyCell value={l.saleAmount} /></ReportTd>
              <ReportTd align="right"><MoneyCell value={l.costAmount} /></ReportTd>
              <ReportTd align="right"><MoneyCell value={l.taxAmount} /></ReportTd>
            </ReportTr>
          ))}
        </tbody>
        <tfoot>
          <TotalsRow testId="ro-distribution-sigma-row">
            <ReportTd>Σ lines</ReportTd>
            <ReportTd colSpan={2}> </ReportTd>
            <ReportTd align="right"><MoneyCell value={sumSale} /></ReportTd>
            <ReportTd align="right"><MoneyCell value={sumCost} /></ReportTd>
            <ReportTd align="right"><MoneyCell value={sumTax} /></ReportTd>
          </TotalsRow>
          <TotalsRow testId="ro-distribution-total-row">
            <ReportTd>RO total (source)</ReportTd>
            <ReportTd colSpan={2}> </ReportTd>
            <ReportTd align="right"><MoneyCell value={total} /></ReportTd>
            <ReportTd colSpan={2}> </ReportTd>
          </TotalsRow>
        </tfoot>
      </FinancialTable>
      <div className="mt-2" data-testid="ro-distribution-conservation-badge">
        <Badge variant={conserves ? 'success' : 'danger'} dot>
          {conserves ? 'CONSERVES TO THE CENT' : 'MISMATCH — Σ lines ≠ RO total'}
        </Badge>
      </div>
    </div>
  );
}

function JournalsTab({ ro }: { ro: any }) {
  return (
    <FinancialTable testId="ro-journals-table">
      <ReportThead>
        <tr>
          <ReportTh>Close version</ReportTh>
          <ReportTh>Status</ReportTh>
          <ReportTh>Journal #</ReportTh>
          <ReportTh>Rule-pack version</ReportTh>
          <ReportTh>Reversal chain</ReportTh>
        </tr>
      </ReportThead>
      <tbody>
        {ro.closeSubmissions.map((s: RoCloseSubmission) => {
          const reversal = ro.reversals.find((r: any) => r.closeVersionReversed === s.closeVersion);
          return (
            <ReportTr key={s.id} testId={`ro-journal-row-v${s.closeVersion}`}>
              <ReportTd>v{s.closeVersion}</ReportTd>
              <ReportTd><StatusBadge status={s.status} /></ReportTd>
              <ReportTd className="font-mono text-xs">{s.journalNumber ?? '—'}</ReportTd>
              <ReportTd className="font-mono text-xs">{s.rulePackVersionId ?? '—'}</ReportTd>
              <ReportTd>
                {reversal ? (
                  <span data-testid={`ro-reversal-pair-v${s.closeVersion}`}>
                    <StatusBadge status={reversal.action} /> → <StatusBadge status={reversal.status} />
                    {reversal.reversalJournalEntryId && <span className="ml-1 font-mono text-xs">({reversal.reversalJournalEntryId.slice(0, 8)}…)</span>}
                    {reversal.refusalCode && <span className="ml-1 text-red-600 text-xs">refused: {reversal.refusalCode}</span>}
                  </span>
                ) : '—'}
              </ReportTd>
            </ReportTr>
          );
        })}
      </tbody>
    </FinancialTable>
  );
}

function ScheduleEffectsTab({ ro }: { ro: any }) {
  const warrantyLines = ro.closeSubmissions.flatMap((s: RoCloseSubmission) => s.lines.filter((l) => l.payType === 'W'));
  if (warrantyLines.length === 0) {
    return <EmptyState testId="ro-schedule-empty" title="No schedule-effect items" message="This RO has no warranty-pay lines, so no claim receivable item was created." />;
  }
  return (
    <div data-testid="ro-schedule-effects">
      <Banner kind="info" testId="ro-schedule-pending-banner" title="PENDING_CE07_TECHNICAL_RECONCILIATION">
        Warranty claim receivable items are populated by fixedops-service's own narrow schedule-effect projection
        (not CE-08's schedule-service) because coa-service's outbox event does not yet carry the scheduleNumber/
        applyNumber/applyCd shape schedule-service subscribes to. The claim lifecycle below is real and governed —
        only the "auto-flow into the generic schedule engine" plumbing is pending upstream reconciliation.
      </Banner>
      <p className="text-xs text-gray-600 mt-2">
        See the Warranty Receivable &amp; Claim Aging screen for full claim lifecycle management for this RO's warranty-pay lines.
      </p>
    </div>
  );
}

export default function RoAccountingDetail() {
  const { roNumber = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [storeId, setStoreId] = useState(searchParams.get('storeId') ?? '');
  const [tab, setTab] = useState<'distribution' | 'journals' | 'schedule' | 'audit'>('distribution');
  const [confirmAction, setConfirmAction] = useState<'reopen' | 'void' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: ro, isLoading, error, refetch } = useQuery({
    queryKey: ['ro-detail', roNumber, storeId],
    queryFn: () => fixedopsApi.getRo(roNumber, storeId),
    enabled: !!roNumber && !!storeId,
  });

  const latestSubmission = ro?.closeSubmissions?.[0];
  const unauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;

  async function doAction(action: 'reopen' | 'void') {
    if (!ro) return;
    setActionError(null);
    setActionResult(null);
    try {
      const payload = {
        legalEntityId: ro.legalEntityId, storeId: ro.storeId,
        sourceEventId: crypto.randomUUID(), correlationId: crypto.randomUUID(),
      };
      const result = action === 'reopen' ? await fixedopsApi.reopenRo(roNumber, payload) : await fixedopsApi.voidRo(roNumber, payload);
      if (result.status === 'REFUSED') {
        setActionError(`Refused: ${result.refusalCode}`);
      } else {
        setActionResult(`${action === 'reopen' ? 'Reopened' : 'Voided'} — reversal journal ${result.reversalJournalEntryId ?? '(pending)'}`);
      }
      await qc.invalidateQueries({ queryKey: ['ro-detail', roNumber, storeId] });
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setConfirmAction(null);
    }
  }

  return (
    <div className="p-4">
      <PageHeader title={`RO Accounting Detail — ${roNumber}`} subtitle="Mixed-pay distribution, journal chain, schedule effects, and audit history for this repair order." />

      {!storeId && (
        <FilterBar>
          <FilterField label="Store" width={160}>
            <input className={FILTER_CONTROL_CLASS} value={storeId} onChange={(e) => setStoreId(e.target.value)} placeholder="Required" data-testid="ro-detail-store-input" />
          </FilterField>
        </FilterBar>
      )}

      {storeId && isLoading && <LoadingState testId="ro-detail-loading" label="Loading RO…" />}
      {storeId && error && !unauthorized && <ErrorState testId="ro-detail-error" message={(error as Error).message} onRetry={() => refetch()} />}
      {storeId && unauthorized && <UnauthorizedState testId="ro-detail-unauthorized" message="You do not have permission to view this RO (fixedops.ro.view)." />}
      {storeId && !isLoading && !error && !ro && <EmptyState testId="ro-detail-not-found" title="RO not found" message={`No repair order ${roNumber} found for store ${storeId}.`} />}

      {ro && (
        <>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <StatusBadge status={ro.status} />
            <span className="text-xs text-gray-600">Store {ro.storeId}</span>
            <span className="text-xs text-gray-600">Close version {ro.currentCloseVersion}</span>
            {ro.wipMode && <span className="text-xs text-gray-600">WIP mode: {ro.wipMode}</span>}
            <div className="ml-auto flex gap-2">
              <Btn size="sm" variant="secondary" onClick={() => setConfirmAction('reopen')} disabled={ro.status === 'OPEN' || ro.status === 'VOIDED'} data-testid="ro-detail-reopen-button">
                Reopen
              </Btn>
              <Btn size="sm" variant="danger" onClick={() => setConfirmAction('void')} disabled={ro.status !== 'CLOSED'} data-testid="ro-detail-void-button">
                Void
              </Btn>
            </div>
          </div>

          {actionResult && <Banner kind="success" title={actionResult} testId="ro-detail-action-success" />}
          {actionError && <Banner kind="error" title={actionError} testId="ro-detail-action-error" />}

          {confirmAction && (
            <div className="fixed inset-0 bg-black/30 z-40 flex items-center justify-center">
              <div className="bg-white rounded shadow-xl p-4 w-full max-w-sm" data-testid="ro-detail-confirm-dialog">
                <p className="text-sm font-semibold mb-2">Confirm {confirmAction}</p>
                <p className="text-xs text-gray-600 mb-4">
                  This will post a deterministic {confirmAction === 'void' ? 'void' : 'reopen'} reversal linked to close v{ro.currentCloseVersion}, restoring the trial balance byte-symmetrically. This action is audited.
                </p>
                <div className="flex justify-end gap-2">
                  <Btn size="sm" variant="secondary" onClick={() => setConfirmAction(null)}>Cancel</Btn>
                  <Btn size="sm" variant="danger" onClick={() => doAction(confirmAction)} data-testid="ro-detail-confirm-submit">Confirm</Btn>
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-4 mb-3 border-b border-gray-200">
            {(['distribution', 'journals', 'schedule', 'audit'] as const).map((t) => (
              <button
                key={t}
                className={`pb-2 text-xs font-medium border-b-2 capitalize ${tab === t ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
                onClick={() => setTab(t)}
                data-testid={`ro-detail-tab-${t}`}
              >
                {t === 'schedule' ? 'Schedule effects' : t}
              </button>
            ))}
          </div>

          {tab === 'distribution' && (latestSubmission
            ? <DistributionTab submission={latestSubmission} />
            : <EmptyState testId="ro-distribution-empty" title="RO has not been closed yet" />)}
          {tab === 'journals' && <JournalsTab ro={ro} />}
          {tab === 'schedule' && <ScheduleEffectsTab ro={ro} />}
          {tab === 'audit' && latestSubmission && <AuditHistoryTab docType="RO_CLOSE_SUBMISSION" docId={latestSubmission.id} testId="ro-detail-audit" />}
          {tab === 'audit' && !latestSubmission && <EmptyState testId="ro-detail-audit-empty" title="No audit history yet" />}
        </>
      )}
    </div>
  );
}

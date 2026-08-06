// CE-11 mandatory UI screen #1 — Fixed Ops Posting Inquiry.
// /accounting/fixedops/postings — Accountant persona.
// All CE-11 journals (RO close, reversal, sublet, deferred, tech-time) with
// pack-version, drill to source doc. Includes the global filterable audit
// view (screen #12) as a second tab per the package's explicit placement.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { fixedopsApi } from '../../../api/fixedopsApi';
import {
  ReportShell, FilterBar, FilterField, FILTER_CONTROL_CLASS,
  FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd,
  EmptyState, ErrorState, LoadingState, UnauthorizedState,
} from '../../../components/report';
import { Btn, MoneyCell } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';

function AuditGlobalTab() {
  const [docType, setDocType] = useState('');
  const [action, setAction] = useState('');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fixedops-audit-global', docType, action],
    queryFn: () => fixedopsApi.auditGlobal({ docType: docType || undefined, action: action || undefined }),
  });
  const items = data?.items ?? [];

  return (
    <div>
      <FilterBar>
        <FilterField label="Doc type" width={220}>
          <select className={FILTER_CONTROL_CLASS} value={docType} onChange={(e) => setDocType(e.target.value)} data-testid="fixedops-audit-doctype-filter">
            <option value="">All</option>
            <option value="RO_CLOSE_SUBMISSION">RO Close Submission</option>
            <option value="RO_REVERSAL">RO Reversal</option>
            <option value="SUBLET_PO">Sublet PO</option>
            <option value="SUBLET_INVOICE_MATCH">Sublet Invoice Match</option>
            <option value="WARRANTY_CLAIM_ITEM">Warranty Claim</option>
            <option value="WARRANTY_CLAIM_REMITTANCE">Warranty Remittance</option>
            <option value="WARRANTY_CLAIM_DISPOSITION">Warranty Disposition</option>
            <option value="DEFERRED_MAINTENANCE_CONTRACT">Deferred Contract</option>
            <option value="DEFERRED_MAINTENANCE_REDEMPTION">Deferred Redemption</option>
            <option value="TECH_TIME_ABSORPTION">Tech Time Absorption</option>
            <option value="WIP_MODE_ELECTION">WIP Mode Election</option>
          </select>
        </FilterField>
        <FilterField label="Action" width={160}>
          <input className={FILTER_CONTROL_CLASS} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. POSTED" data-testid="fixedops-audit-action-filter" />
        </FilterField>
      </FilterBar>
      {isLoading && <LoadingState testId="fixedops-audit-loading" label="Loading audit history…" />}
      {error && <ErrorState testId="fixedops-audit-error" message={(error as Error).message} onRetry={() => refetch()} />}
      {!isLoading && !error && items.length === 0 && (
        <EmptyState testId="fixedops-audit-empty" title="No audit events for this filter." />
      )}
      {!isLoading && !error && items.length > 0 && (
        <FinancialTable testId="fixedops-audit-table">
          <ReportThead>
            <tr>
              <ReportTh>When</ReportTh>
              <ReportTh>Doc type</ReportTh>
              <ReportTh>Doc ID</ReportTh>
              <ReportTh>Action</ReportTh>
              <ReportTh>Actor</ReportTh>
              <ReportTh>Correlation</ReportTh>
              <ReportTh>Reason</ReportTh>
            </tr>
          </ReportThead>
          <tbody>
            {items.map((ev) => (
              <ReportTr key={ev.id} testId={`fixedops-audit-row-${ev.id}`}>
                <ReportTd className="font-mono text-xs">{new Date(ev.createdAt).toLocaleString()}</ReportTd>
                <ReportTd>{ev.docType}</ReportTd>
                <ReportTd className="font-mono text-xs">{ev.docId}</ReportTd>
                <ReportTd><StatusBadge status={ev.action} /></ReportTd>
                <ReportTd className="font-mono text-xs">{ev.actor}</ReportTd>
                <ReportTd className="font-mono text-xs">{ev.correlationId ?? '—'}</ReportTd>
                <ReportTd>{ev.reason ?? '—'}</ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}
    </div>
  );
}

export default function FixedOpsPostingInquiry() {
  const { entityId } = useEntityScope();
  const [tab, setTab] = useState<'postings' | 'audit'>('postings');
  const [storeId, setStoreId] = useState('');
  const [status, setStatus] = useState('');
  const [payType, setPayType] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['fixedops-postings', storeId, status, payType],
    queryFn: () => fixedopsApi.listPostings({ storeId: storeId || undefined, status: status || undefined, payType: payType || undefined }),
  });

  const unauthorized = (error as any)?.status === 401 || (error as any)?.status === 403;
  const items = data?.items ?? [];

  return (
    <ReportShell
      title="Fixed Ops Posting Inquiry"
      description="Every CE-11 journal — RO close, reversal, sublet accrual/relief, deferred sale/redemption, tech-time absorption — with rule-pack version and source-document linkage."
      scopeFields={[{ label: 'Legal entity', value: entityId ?? 'Not selected', muted: !entityId }]}
    >
      <div className="flex gap-4 mb-3 border-b border-gray-200">
        <button
          className={`pb-2 text-xs font-medium border-b-2 ${tab === 'postings' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
          onClick={() => setTab('postings')}
          data-testid="fixedops-postings-tab-postings"
        >
          Postings
        </button>
        <button
          className={`pb-2 text-xs font-medium border-b-2 ${tab === 'audit' ? 'border-brand text-brand' : 'border-transparent text-gray-500'}`}
          onClick={() => setTab('audit')}
          data-testid="fixedops-postings-tab-audit"
        >
          Audit &amp; Lineage History
        </button>
      </div>

      {tab === 'audit' && <AuditGlobalTab />}

      {tab === 'postings' && (
        <>
          <FilterBar>
            <FilterField label="Store" width={140}>
              <input className={FILTER_CONTROL_CLASS} value={storeId} onChange={(e) => setStoreId(e.target.value)} data-testid="fixedops-postings-store-filter" />
            </FilterField>
            <FilterField label="Status" width={200}>
              <select className={FILTER_CONTROL_CLASS} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="fixedops-postings-status-filter">
                <option value="">All</option>
                <option value="POSTED">Posted</option>
                <option value="EXCEPTION">Exception</option>
                <option value="BLOCKED_TAX_UNAVAILABLE">Blocked (tax unavailable)</option>
                <option value="REJECTED_MAPPING">Rejected (mapping)</option>
              </select>
            </FilterField>
            <FilterField label="Pay type" width={140}>
              <select className={FILTER_CONTROL_CLASS} value={payType} onChange={(e) => setPayType(e.target.value)} data-testid="fixedops-postings-paytype-filter">
                <option value="">All</option>
                <option value="C">Customer</option>
                <option value="W">Warranty</option>
                <option value="I">Internal</option>
              </select>
            </FilterField>
            <Btn size="sm" onClick={() => refetch()} data-testid="fixedops-postings-refresh">Refresh</Btn>
          </FilterBar>

          {isLoading && <LoadingState testId="fixedops-postings-loading" label="Loading postings…" />}
          {error && !unauthorized && <ErrorState testId="fixedops-postings-error" message={(error as Error).message} onRetry={() => refetch()} />}
          {unauthorized && <UnauthorizedState testId="fixedops-postings-unauthorized" message="You do not have permission to view Fixed Ops postings (fixedops.ro.view)." />}

          {!isLoading && !error && items.length === 0 && (
            <EmptyState testId="fixedops-postings-empty" title="No postings for this filter" message="No RO close submissions match the current scope." />
          )}

          {!isLoading && !error && items.length > 0 && (
            <FinancialTable testId="fixedops-postings-table">
              <ReportThead>
                <tr>
                  <ReportTh>RO#</ReportTh>
                  <ReportTh>Pay mix</ReportTh>
                  <ReportTh>Status</ReportTh>
                  <ReportTh align="right">Sale</ReportTh>
                  <ReportTh align="right">Cost</ReportTh>
                  <ReportTh align="right">Tax</ReportTh>
                  <ReportTh>Journal #</ReportTh>
                  <ReportTh>Rule-pack version</ReportTh>
                  <ReportTh>When</ReportTh>
                </tr>
              </ReportThead>
              <tbody>
                {items.map((p) => (
                  <ReportTr key={p.id} testId={`fixedops-posting-row-${p.roNumber}-${p.closeVersion}`}>
                    <ReportTd>
                      <Link to={`/accounting/fixedops/ro/${encodeURIComponent(p.roNumber)}`} className="text-brand hover:underline font-mono">
                        {p.roNumber} <span className="text-gray-400">v{p.closeVersion}</span>
                      </Link>
                    </ReportTd>
                    <ReportTd>{p.payTypeMix}</ReportTd>
                    <ReportTd><StatusBadge status={p.status} /></ReportTd>
                    <ReportTd align="right"><MoneyCell value={p.totalSaleAmount} /></ReportTd>
                    <ReportTd align="right"><MoneyCell value={p.totalCostAmount} /></ReportTd>
                    <ReportTd align="right"><MoneyCell value={p.totalTaxAmount} /></ReportTd>
                    <ReportTd className="font-mono text-xs">{p.journalNumber ?? '—'}</ReportTd>
                    <ReportTd className="font-mono text-xs">{p.rulePackVersionId ?? '—'}</ReportTd>
                    <ReportTd className="text-xs">{new Date(p.createdAt).toLocaleString()}</ReportTd>
                  </ReportTr>
                ))}
              </tbody>
            </FinancialTable>
          )}
        </>
      )}
    </ReportShell>
  );
}

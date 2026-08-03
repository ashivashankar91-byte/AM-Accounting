import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import { PageHeader } from '../../../components/ui';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { EmptyState, FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd } from '../../../components/report';
import { useEntityScope } from '../../../context/EntityScopeContext';
import { hasPayrollPermission, parsePayrollPermissions, PAYROLL_PERMISSIONS } from './payrollPermissions';

// fix(integration) Gap 4 / requirement 1.D — payroll audit inquiry. Every row
// is real, persisted evidence surfaced by GET /audit (source events already
// emitted by postBatch/voidBatch, and PayrollSensitiveReadAudit rows already
// written on every sensitive-detail read) — nothing here is reconstructed or
// guessed. payroll.audit.view is enforced server-side (see ce13-routes.ts /
// security.ts) and — via the nav item's `permission` field — in nav
// visibility (see App.tsx's MODULES entry and NavRail's filter).
export default function PayrollAudit() {
  const permissions = parsePayrollPermissions();
  const canView = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.AUDIT_VIEW);
  const { entityId, entities, setEntity } = useEntityScope();

  const [filters, setFilters] = useState({ batchId: '', employeeId: '', action: '', actor: '', fromDate: '', toDate: '' });

  const auditQuery = useQuery({
    queryKey: ['payroll-audit', entityId, filters],
    queryFn: () =>
      payrollApi.getAudit({
        legalEntityId: entityId ?? undefined,
        batchId: filters.batchId || undefined,
        employeeId: filters.employeeId || undefined,
        action: filters.action || undefined,
        actor: filters.actor || undefined,
        fromDate: filters.fromDate || undefined,
        toDate: filters.toDate || undefined,
      }),
    retry: false,
    enabled: canView,
  });

  if (!canView) {
    return (
      <div className="p-7" data-testid="payroll-audit-unauthorized">
        <EmptyState testId="payroll-audit-unauthorized-inner" title="Unauthorized" message="Viewing the payroll audit trail requires payroll.audit.view. Contact your Controller or Admin." />
      </div>
    );
  }

  return (
    <div className="p-7 min-h-full" data-testid="payroll-audit-page">
      <PageHeader
        title="Payroll Audit"
        subtitle="Real, persisted evidence: source posting events, journal/reversal linkage, and every sensitive-detail read — never reconstructed."
      />

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-4 grid grid-cols-3 md:grid-cols-6 gap-3" data-testid="payroll-audit-filters">
        <label className="text-xs font-semibold text-slate-600">
          Legal entity
          <select
            className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
            value={entityId ?? ''}
            onChange={(e) => {
              const picked = entities.find((en) => en.id === e.target.value);
              if (picked) setEntity(picked.id, `${picked.entityCode} — ${picked.legalName}`);
            }}
            data-testid="payroll-audit-entity-select"
          >
            <option value="">All entities</option>
            {entities.map((en) => (
              <option key={en.id} value={en.id}>{en.entityCode} — {en.legalName}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">Batch ID
          <input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={filters.batchId} onChange={(e) => setFilters({ ...filters, batchId: e.target.value })} data-testid="payroll-audit-filter-batch" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Employee ID
          <input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={filters.employeeId} onChange={(e) => setFilters({ ...filters, employeeId: e.target.value })} data-testid="payroll-audit-filter-employee" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Action
          <input placeholder="e.g. PAYROLL_BATCH_POSTED" className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} data-testid="payroll-audit-filter-action" />
        </label>
        <label className="text-xs font-semibold text-slate-600">Actor
          <input className="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={filters.actor} onChange={(e) => setFilters({ ...filters, actor: e.target.value })} data-testid="payroll-audit-filter-actor" />
        </label>
        <label className="text-xs font-semibold text-slate-600">From / To date
          <div className="flex gap-1 mt-1">
            <input type="date" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={filters.fromDate} onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })} data-testid="payroll-audit-filter-from" />
            <input type="date" className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" value={filters.toDate} onChange={(e) => setFilters({ ...filters, toDate: e.target.value })} data-testid="payroll-audit-filter-to" />
          </div>
        </label>
      </div>

      {auditQuery.isLoading ? (
        <PageLoader page="Payroll Audit" service="payroll-service" port={3012} />
      ) : auditQuery.error ? (
        <PageError error={auditQuery.error as Error} serviceName="payroll-service" port={3012} retry={() => auditQuery.refetch()} />
      ) : (auditQuery.data?.items ?? []).length === 0 ? (
        <EmptyState testId="payroll-audit-empty" title="No audit entries match these filters" message="Source posting events and sensitive-detail reads will appear here as they occur." />
      ) : (
        <FinancialTable testId="payroll-audit-table">
          <ReportThead>
            <ReportTh>Timestamp</ReportTh>
            <ReportTh>Kind</ReportTh>
            <ReportTh>Action</ReportTh>
            <ReportTh>Actor</ReportTh>
            <ReportTh>Batch</ReportTh>
            <ReportTh>Employee</ReportTh>
            <ReportTh>Journal</ReportTh>
            <ReportTh>Reversal of</ReportTh>
          </ReportThead>
          <tbody>
            {(auditQuery.data?.items ?? []).map((entry: any) => (
              <ReportTr key={entry.id} testId={`payroll-audit-row-${entry.id}`}>
                <ReportTd>{new Date(entry.occurredAt).toLocaleString()}</ReportTd>
                <ReportTd>{entry.kind}</ReportTd>
                <ReportTd>{entry.action}</ReportTd>
                <ReportTd>{entry.actor ?? '—'}</ReportTd>
                <ReportTd>{entry.batchId ?? '—'}</ReportTd>
                <ReportTd>{entry.employeeId ?? '—'}</ReportTd>
                <ReportTd>
                  {entry.journalEntryId ? (
                    <a className="underline text-brand" href={`/accounting/gl/journal-entries/${entry.journalEntryId}`}>{entry.journalEntryId}</a>
                  ) : '—'}
                </ReportTd>
                <ReportTd>{entry.reversalOfBatchId ?? '—'}</ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}
    </div>
  );
}

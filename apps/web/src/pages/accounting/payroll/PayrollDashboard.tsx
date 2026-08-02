import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PlusCircle } from 'lucide-react';
import { payrollApi } from '../../../api/client';
import { PageHeader, Btn, EmptyState as UiEmptyState } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { Banner, EmptyState, FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd } from '../../../components/report';

// CE-13 — Payroll Dashboard (S108). Landing surface for the unified
// Accounting application's payroll module: statutory-source boundary
// status banner (never silently "configured"), the batch list, and quick
// actions into batch creation and the batch workbench
// (PayrollBatchWorkbench.tsx) where earnings/deductions, validation,
// approval, hold/release, posting, register and YTD all live as tabs of a
// single governed batch lifecycle screen — per the epic's "use the
// unified Accounting application, do not create a separate Payroll app
// shell" instruction.
export default function PayrollDashboard() {
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ batchNumber: '', payPeriodStart: '', payPeriodEnd: '', payDate: '', payFrequency: 'BI_WEEKLY', providerRunId: '' });
  const [createError, setCreateError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const sourceModeQuery = useQuery({ queryKey: ['payroll-source-mode'], queryFn: () => payrollApi.getSourceMode(), retry: false });
  const batchesQuery = useQuery({ queryKey: ['payroll-batches'], queryFn: () => payrollApi.getBatches(), retry: false });

  if (batchesQuery.isLoading) return <PageLoader page="Payroll Dashboard" service="payroll-service" port={3012} />;
  if (batchesQuery.error) {
    const status = (batchesQuery.error as any)?.status;
    if (status === 401 || status === 403) {
      return <div className="p-7" data-testid="payroll-unauthorized"><UiEmptyState title="Unauthorized" description="You do not have permission to view Payroll. Contact your Controller or Admin." /></div>;
    }
    return <PageError error={batchesQuery.error as Error} serviceName="payroll-service" port={3012} retry={() => batchesQuery.refetch()} />;
  }

  const batches = batchesQuery.data ?? [];
  const sourceMode = sourceModeQuery.data?.payrollSourceMode ?? 'NOT_CONFIGURED';

  async function createBatch() {
    setCreateError(null);
    try {
      await payrollApi.submit({
        batchNumber: form.batchNumber,
        payPeriodStart: form.payPeriodStart,
        payPeriodEnd: form.payPeriodEnd,
        payDate: form.payDate,
        payFrequency: form.payFrequency,
        ...(form.providerRunId && { providerRunId: form.providerRunId }),
      });
      setShowCreate(false);
      setForm({ batchNumber: '', payPeriodStart: '', payPeriodEnd: '', payDate: '', payFrequency: 'BI_WEEKLY', providerRunId: '' });
      await queryClient.invalidateQueries({ queryKey: ['payroll-batches'] });
    } catch (err: any) {
      // Surfaces DUPLICATE_PAYROLL_RUN (409) truthfully rather than retrying silently.
      setCreateError(err.message);
    }
  }

  return (
    <div className="p-7 min-h-full" data-testid="payroll-dashboard-page">
      <PageHeader
        title="Payroll"
        subtitle="Batches, statutory-source boundary status, and governed GL posting (CE-13)."
        actions={
          <Btn variant="primary" size="md" icon={<PlusCircle size={14} />} onClick={() => setShowCreate(true)} data-testid="payroll-new-batch-btn">
            New batch
          </Btn>
        }
      />

      {sourceMode === 'NOT_CONFIGURED' && (
        <Banner kind="warning" testId="payroll-source-not-configured-banner" title="PAYROLL_SOURCE_NOT_CONFIGURED — no certified payroll withholding source is configured for this tenant.">
          Every payroll item blocks at validation, naming the affected employee, until withholding is attested from a provider register or a
          certification-only test fixture is enabled. Nothing is ever silently estimated.{' '}
          <a href="/accounting/payroll/governance" className="underline">Configure source mode</a>.
        </Banner>
      )}

      {showCreate && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 mb-6" data-testid="payroll-create-batch-form">
          <div className="grid grid-cols-3 gap-4">
            <label className="text-xs font-semibold text-slate-600">Batch number
              <input className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} data-testid="payroll-batch-number-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">Pay frequency
              <select className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.payFrequency} onChange={(e) => setForm({ ...form, payFrequency: e.target.value })}>
                <option value="WEEKLY">Weekly</option>
                <option value="BI_WEEKLY">Bi-weekly</option>
                <option value="SEMI_MONTHLY">Semi-monthly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">Provider run ID (idempotency)
              <input className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.providerRunId} onChange={(e) => setForm({ ...form, providerRunId: e.target.value })} data-testid="payroll-provider-run-id-input" />
            </label>
            <label className="text-xs font-semibold text-slate-600">Pay period start
              <input type="date" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.payPeriodStart} onChange={(e) => setForm({ ...form, payPeriodStart: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-600">Pay period end
              <input type="date" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.payPeriodEnd} onChange={(e) => setForm({ ...form, payPeriodEnd: e.target.value })} />
            </label>
            <label className="text-xs font-semibold text-slate-600">Pay date
              <input type="date" className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={form.payDate} onChange={(e) => setForm({ ...form, payDate: e.target.value })} />
            </label>
          </div>
          {createError && <Banner kind="error" testId="payroll-create-batch-error" title="Could not create batch">{createError}</Banner>}
          <div className="flex gap-2 mt-4">
            <Btn variant="primary" size="sm" onClick={createBatch} data-testid="payroll-create-batch-submit">Create</Btn>
            <Btn variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {batches.length === 0 ? (
        <EmptyState testId="payroll-batches-empty" title="No payroll batches yet" message="Create a batch to begin the payroll cycle." />
      ) : (
        <FinancialTable testId="payroll-batches-table">
          <ReportThead>
            <ReportTh>Batch #</ReportTh>
            <ReportTh>Pay period</ReportTh>
            <ReportTh>Pay date</ReportTh>
            <ReportTh>Status</ReportTh>
            <ReportTh align="right">Gross pay</ReportTh>
            <ReportTh align="right">Net pay</ReportTh>
            <ReportTh>Employees</ReportTh>
          </ReportThead>
          <tbody>
            {batches.map((b: any) => (
              <ReportTr key={b.id} onClick={() => { window.location.href = `/accounting/payroll/batches/${b.id}`; }} testId={`payroll-batch-row-${b.id}`}>
                <ReportTd>{b.batchNumber}</ReportTd>
                <ReportTd>{String(b.payPeriodStart).slice(0, 10)} – {String(b.payPeriodEnd).slice(0, 10)}</ReportTd>
                <ReportTd>{String(b.payDate).slice(0, 10)}</ReportTd>
                <ReportTd><StatusBadge status={b.status} /></ReportTd>
                <ReportTd align="right">{Number(b.totalGrossPay ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</ReportTd>
                <ReportTd align="right">{Number(b.totalNetPay ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' })}</ReportTd>
                <ReportTd>{b.employeeCount}</ReportTd>
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}
    </div>
  );
}

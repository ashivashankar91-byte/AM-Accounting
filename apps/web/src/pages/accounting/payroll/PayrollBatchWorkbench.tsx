import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import { PageHeader, Btn } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import PageLoader from '../../../components/PageLoader';
import PageError from '../../../components/PageError';
import { Banner, EmptyState, FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, MoneyTd } from '../../../components/report';
import { hasPayrollPermission, parsePayrollPermissions, PAYROLL_PERMISSIONS } from './payrollPermissions';

type Tab = 'items' | 'validation' | 'approval' | 'posting' | 'register' | 'ytd';

// CE-13 — Payroll Batch Workbench (S108/S110/S111). One governed batch
// lifecycle screen, tabbed per the epic's mandatory UI surfaces:
// earnings/deduction detail, validation results, approval queue/review +
// hold/release, posting result + journal linkage, payroll register, and
// employee YTD inquiry. Every action calls a real payroll-service API —
// no client-side statutory calculation, no mock data.
export default function PayrollBatchWorkbench() {
  const { batchId = '' } = useParams();
  const [tab, setTab] = useState<Tab>('items');
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [ytdEmployeeId, setYtdEmployeeId] = useState('');
  const [ytdYear, setYtdYear] = useState(new Date().getFullYear());
  const [itemForm, setItemForm] = useState({ employeeId: '', regularPay: '', overtimePay: '', commissionPay: '', bonusPay: '', attestedGrossWithholding: '', attestedBy: '', sourceDocumentRef: '' });
  const queryClient = useQueryClient();
  const permissions = parsePayrollPermissions();
  const canEdit = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.BATCH_EDIT);
  const canValidate = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.BATCH_VALIDATE);
  const canApprove = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.BATCH_APPROVE);
  const canHoldRelease = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.BATCH_HOLD_RELEASE);
  const canPost = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.BATCH_POST);
  const canVoidReverse = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.BATCH_VOID_REVERSE);

  const batchQuery = useQuery({ queryKey: ['payroll-batch', batchId], queryFn: () => payrollApi.getBatch(batchId), retry: false, enabled: !!batchId });
  const registerQuery = useQuery({ queryKey: ['payroll-register', batchId], queryFn: () => payrollApi.getRegister(batchId), retry: false, enabled: tab === 'register' && !!batchId });
  const ytdQuery = useQuery({
    queryKey: ['payroll-ytd', ytdEmployeeId, ytdYear],
    queryFn: () => payrollApi.getEmployeeYTD(ytdEmployeeId, ytdYear),
    retry: false,
    enabled: false,
  });

  if (batchQuery.isLoading) return <PageLoader page="Payroll Batch" service="payroll-service" port={3012} />;
  if (batchQuery.error) {
    const status = (batchQuery.error as any)?.status;
    if (status === 401 || status === 403) {
      return <div className="p-7"><EmptyState testId="payroll-batch-unauthorized" title="Unauthorized" message="You do not have permission to view this batch." /></div>;
    }
    return <PageError error={batchQuery.error as Error} serviceName="payroll-service" port={3012} retry={() => batchQuery.refetch()} />;
  }

  const batch = batchQuery.data;
  const items = batch?.items ?? [];

  async function runAction(fn: () => Promise<any>, refetchKeys: string[][] = [['payroll-batch', batchId]]) {
    setActionError(null);
    setActionResult(null);
    try {
      const result = await fn();
      setActionResult(JSON.stringify(result, null, 2));
      for (const key of refetchKeys) await queryClient.invalidateQueries({ queryKey: key });
    } catch (err: any) {
      // Truthfully surfaces PAYROLL_SOURCE_NOT_CONFIGURED, DUPLICATE_PAYROLL_RUN,
      // ACCOUNT_MAPPING_VALUES_PENDING and SoD self-approval-denial errors rather
      // than retrying or masking them.
      setActionError(err.message);
    }
  }

  return (
    <div className="p-7 min-h-full" data-testid="payroll-batch-workbench-page">
      <PageHeader
        title={`Batch ${batch?.batchNumber ?? batchId}`}
        subtitle="Governed batch lifecycle — earnings, validation, approval, hold/release, posting, register and YTD."
        badge={<StatusBadge status={batch?.status} />}
      />

      {batch?.status === 'HOLD' && (
        <Banner kind="warning" testId="payroll-batch-hold-banner" title="On hold">
          {batch.holdReason} — held by {batch.heldBy}. Release before validating or approving.
        </Banner>
      )}
      {actionError && <Banner kind="error" testId="payroll-batch-action-error" title="Action failed">{actionError}</Banner>}
      {actionResult && <Banner kind="success" testId="payroll-batch-action-result" title="Success"><pre className="text-[11px] whitespace-pre-wrap">{actionResult}</pre></Banner>}

      <div className="flex items-center gap-1 border-b border-slate-200 mt-6 mb-4 flex-wrap">
        {(['items', 'validation', 'approval', 'posting', 'register', 'ytd'] as Tab[]).map((t) => (
          <button
            key={t}
            className={`px-3 py-2 text-[13px] font-semibold border-b-2 capitalize ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`}
            onClick={() => setTab(t)}
            data-testid={`payroll-batch-tab-${t}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6" data-testid="payroll-add-item-form">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Add earnings / deduction line</h3>
            <div className="grid grid-cols-4 gap-3">
              <input placeholder="Employee ID" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={itemForm.employeeId} onChange={(e) => setItemForm({ ...itemForm, employeeId: e.target.value })} data-testid="payroll-item-employee-id" />
              <input placeholder="Regular pay" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={itemForm.regularPay} onChange={(e) => setItemForm({ ...itemForm, regularPay: e.target.value })} />
              <input placeholder="Overtime pay" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={itemForm.overtimePay} onChange={(e) => setItemForm({ ...itemForm, overtimePay: e.target.value })} />
              <input placeholder="Commission pay" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={itemForm.commissionPay} onChange={(e) => setItemForm({ ...itemForm, commissionPay: e.target.value })} />
              <input placeholder="Bonus pay" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={itemForm.bonusPay} onChange={(e) => setItemForm({ ...itemForm, bonusPay: e.target.value })} />
              <input placeholder="Attested gross withholding (if AttestedManualSource)" className="border border-slate-300 rounded-lg px-3 py-2 text-sm col-span-2" value={itemForm.attestedGrossWithholding} onChange={(e) => setItemForm({ ...itemForm, attestedGrossWithholding: e.target.value })} />
              <input placeholder="Attested by (name/id)" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={itemForm.attestedBy} onChange={(e) => setItemForm({ ...itemForm, attestedBy: e.target.value })} data-testid="payroll-item-attested-by" />
              <input placeholder="Source document ref (provider register #)" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={itemForm.sourceDocumentRef} onChange={(e) => setItemForm({ ...itemForm, sourceDocumentRef: e.target.value })} />
            </div>
            <Btn
              variant="primary" size="sm" className="mt-3" data-testid="payroll-item-submit"
              disabled={!canEdit}
              title={!canEdit ? 'Requires payroll.batch.edit permission' : undefined}
              onClick={() => runAction(() => payrollApi.addBatchItem(batchId, {
                employeeId: itemForm.employeeId,
                regularPay: Number(itemForm.regularPay || 0),
                overtimePay: Number(itemForm.overtimePay || 0),
                commissionPay: Number(itemForm.commissionPay || 0),
                bonusPay: Number(itemForm.bonusPay || 0),
                attestedBy: itemForm.attestedBy || undefined,
                sourceDocumentRef: itemForm.sourceDocumentRef || undefined,
                ...(itemForm.attestedGrossWithholding && {
                  attestedWithholding: { totalWithholding: Number(itemForm.attestedGrossWithholding) },
                }),
              }))}
            >
              Add line
            </Btn>
          </div>

          {items.length === 0 ? (
            <EmptyState testId="payroll-items-empty" title="No earnings/deduction lines yet" message="Add a line above." />
          ) : (
            <FinancialTable testId="payroll-items-table">
              <ReportThead>
                <ReportTh>Employee</ReportTh>
                <ReportTh align="right">Gross pay</ReportTh>
                <ReportTh>Withholding status</ReportTh>
                <ReportTh>Source</ReportTh>
                <ReportTh align="right">Net pay</ReportTh>
              </ReportThead>
              <tbody>
                {items.map((i: any) => (
                  <ReportTr key={i.id} testId={`payroll-item-row-${i.id}`}>
                    <ReportTd>{i.employeeId}</ReportTd>
                    <MoneyTd value={Number(i.grossPay ?? 0)} />
                    <ReportTd><StatusBadge status={i.withholdingStatus} /></ReportTd>
                    <ReportTd>{i.withholdingSource ?? '—'}</ReportTd>
                    <MoneyTd value={Number(i.netPay ?? 0)} />
                  </ReportTr>
                ))}
              </tbody>
            </FinancialTable>
          )}
        </div>
      )}

      {tab === 'validation' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6" data-testid="payroll-validation-panel">
          <p className="text-sm text-slate-600 mb-3">
            Validates pay-period integrity, GL-mapping readiness, and the statutory-boundary Rule 10 (every item's withholding
            must be attested or a labeled test fixture — never NOT_CONFIGURED).
          </p>
          <Btn variant="primary" size="sm" disabled={!canValidate} title={!canValidate ? 'Requires payroll.batch.validate permission' : undefined} data-testid="payroll-validate-btn" onClick={() => runAction(() => payrollApi.validate(batchId))}>Run validation</Btn>
        </div>
      )}

      {tab === 'approval' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4" data-testid="payroll-approval-panel">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Approve</h3>
            <p className="text-xs text-slate-500 mb-2">The batch preparer cannot also approve it (segregation of duties — self-approval is denied with a 403).</p>
            <Btn variant="primary" size="sm" disabled={!canApprove} title={!canApprove ? 'Requires payroll.batch.approve permission' : undefined} data-testid="payroll-approve-btn" onClick={() => runAction(() => payrollApi.approveBatch(batchId))}>Approve batch</Btn>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Hold / release</h3>
            <div className="flex gap-2">
              <input placeholder="Hold reason" className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} data-testid="payroll-hold-reason-input" />
              <Btn variant="secondary" size="sm" disabled={!canHoldRelease} title={!canHoldRelease ? 'Requires payroll.batch.hold_release permission' : undefined} data-testid="payroll-hold-btn" onClick={() => runAction(() => payrollApi.hold(batchId, holdReason))}>Hold</Btn>
              <Btn variant="secondary" size="sm" disabled={!canHoldRelease} title={!canHoldRelease ? 'Requires payroll.batch.hold_release permission' : undefined} data-testid="payroll-release-btn" onClick={() => runAction(() => payrollApi.release(batchId))}>Release</Btn>
            </div>
          </div>
        </div>
      )}

      {tab === 'posting' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4" data-testid="payroll-posting-panel">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Post to GL</h3>
            <p className="text-xs text-slate-500 mb-2">
              Posting never writes GL journals directly — it drafts through gl-service's governed posting API, then approves
              and posts. A tenant with an unmapped department/account is refused deterministically (never defaulted to a
              production account number).
            </p>
            <Btn variant="primary" size="sm" disabled={!canPost} title={!canPost ? 'Requires payroll.batch.post permission' : undefined} data-testid="payroll-post-btn" onClick={() => runAction(() => payrollApi.post(batchId))}>Post batch</Btn>
            {batch?.journalEntryId && (
              <p className="text-xs text-slate-600 mt-2" data-testid="payroll-journal-link">
                Journal entry: <a className="underline text-brand" href={`/accounting/gl/journal-entries/${batch.journalEntryId}`}>{batch.journalEntryId}</a>
              </p>
            )}
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Void / reverse</h3>
            <div className="flex gap-2">
              <input placeholder="Void reason" className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} data-testid="payroll-void-reason-input" />
              <Btn variant="danger" size="sm" disabled={!canVoidReverse} title={!canVoidReverse ? 'Requires payroll.batch.void_reverse permission' : undefined} data-testid="payroll-void-btn" onClick={() => runAction(() => payrollApi.voidBatch(batchId, voidReason))}>Void batch</Btn>
            </div>
          </div>
        </div>
      )}

      {tab === 'register' && (
        registerQuery.isLoading ? <PageLoader page="Payroll Register" service="payroll-service" port={3012} /> :
        registerQuery.error ? <PageError error={registerQuery.error as Error} serviceName="payroll-service" retry={() => registerQuery.refetch()} /> :
        <FinancialTable testId="payroll-register-table">
          <ReportThead>
            <ReportTh>Employee</ReportTh>
            <ReportTh align="right">Gross</ReportTh>
            <ReportTh align="right">Deductions</ReportTh>
            <ReportTh align="right">Net</ReportTh>
            <ReportTh align="right">Employer tax</ReportTh>
          </ReportThead>
          <tbody>
            {(registerQuery.data?.lines ?? registerQuery.data?.items ?? []).map((l: any, idx: number) => (
              <ReportTr key={l.employeeId ?? idx} testId={`payroll-register-row-${idx}`}>
                <ReportTd>{l.employeeId}</ReportTd>
                <MoneyTd value={Number(l.grossPay ?? 0)} />
                <MoneyTd value={Number(l.totalDeductions ?? l.deductions ?? 0)} />
                <MoneyTd value={Number(l.netPay ?? 0)} />
                <MoneyTd value={Number(l.employerTax ?? 0)} />
              </ReportTr>
            ))}
          </tbody>
        </FinancialTable>
      )}

      {tab === 'ytd' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6" data-testid="payroll-ytd-panel">
          <div className="flex gap-2 mb-4">
            <input placeholder="Employee ID" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={ytdEmployeeId} onChange={(e) => setYtdEmployeeId(e.target.value)} data-testid="payroll-ytd-employee-input" />
            <input type="number" className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-28" value={ytdYear} onChange={(e) => setYtdYear(Number(e.target.value))} />
            <Btn variant="primary" size="sm" data-testid="payroll-ytd-lookup-btn" onClick={() => ytdQuery.refetch()}>Look up</Btn>
          </div>
          {ytdQuery.data && (
            <pre className="text-xs bg-slate-50 rounded-lg p-4" data-testid="payroll-ytd-result">{JSON.stringify(ytdQuery.data, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import { PageHeader, Btn } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import PageLoader from '../../../components/PageLoader';
import { Banner, EmptyState, FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd, Drawer, DrawerRow } from '../../../components/report';
import { hasPayrollPermission, parsePayrollPermissions, PAYROLL_PERMISSIONS } from './payrollPermissions';

type Tab = 'plans' | 'records' | 'disputes';

/**
 * S109 — Commission plan/draw/dispute workbench. All commission
 * percentages, flat amounts, tier tables, split shares, draw amounts and
 * minimum guarantees are tenant-configured on CommissionPlan — this screen
 * never hardcodes a dealer policy or rate. Consolidated into the unified
 * Accounting application's Payroll surface (no separate Payroll shell).
 */
export default function PayrollCommissionWorkbench() {
  const [tab, setTab] = useState<Tab>('plans');
  const [actionError, setActionError] = useState<string | null>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [drawDrawerPlanId, setDrawDrawerPlanId] = useState<string | null>(null);
  const [disputeDrawerRecordId, setDisputeDrawerRecordId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const permissions = parsePayrollPermissions();
  const canManageCommissions = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.COMMISSION_MANAGE);
  const canResolveDisputes = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.COMMISSION_DISPUTE_RESOLVE);

  const plansQuery = useQuery({ queryKey: ['commission-plans'], queryFn: () => payrollApi.listCommissionPlans(), retry: false, enabled: tab === 'plans' });
  const recordsQuery = useQuery({ queryKey: ['commission-records'], queryFn: () => payrollApi.listCommissions(), retry: false, enabled: tab === 'records' });
  const disputesQuery = useQuery({ queryKey: ['commission-disputes'], queryFn: () => payrollApi.listCommissionDisputes(), retry: false, enabled: tab === 'disputes' });

  async function act(fn: () => Promise<any>, keys: string[]) {
    setActionError(null);
    try {
      await fn();
      for (const k of keys) await queryClient.invalidateQueries({ queryKey: [k] });
    } catch (err: any) {
      setActionError(err.message);
    }
  }

  return (
    <div className="p-7 min-h-full" data-testid="payroll-commission-page">
      <PageHeader
        title="Commission, Draws &amp; Disputes"
        subtitle="S109 — tenant-configured commission plans, split rules, draws, minimum guarantees, and dispute resolution with SoD enforcement."
      />

      {actionError && <Banner kind="error" testId="commission-action-error" title="Action failed">{actionError}</Banner>}

      <div className="flex items-center justify-between mt-6 mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1 border-b border-slate-200 flex-wrap">
          {(['plans', 'records', 'disputes'] as Tab[]).map((t) => (
            <button key={t} className={`px-3 py-2 text-[13px] font-semibold border-b-2 capitalize ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`} onClick={() => setTab(t)} data-testid={`commission-tab-${t}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'plans' && (
          <Btn variant="primary" size="sm" disabled={!canManageCommissions} title={!canManageCommissions ? 'Requires payroll.commission.manage permission' : undefined} data-testid="commission-new-plan-btn" onClick={() => setNewPlanOpen(true)}>New Plan</Btn>
        )}
      </div>

      {tab === 'plans' && (
        <PlansTab
          data={plansQuery.data}
          loading={plansQuery.isLoading}
          error={plansQuery.isError}
          onDraw={(id) => setDrawDrawerPlanId(id)}
          canManage={canManageCommissions}
        />
      )}
      {tab === 'records' && (
        <RecordsTab
          data={recordsQuery.data}
          loading={recordsQuery.isLoading}
          error={recordsQuery.isError}
          act={act}
          onDispute={(id) => setDisputeDrawerRecordId(id)}
          canManage={canManageCommissions}
        />
      )}
      {tab === 'disputes' && (
        <DisputesTab data={disputesQuery.data} loading={disputesQuery.isLoading} error={disputesQuery.isError} act={act} canResolve={canResolveDisputes} />
      )}

      {newPlanOpen && (
        <NewPlanDrawer
          onClose={() => setNewPlanOpen(false)}
          onCreated={() => { setNewPlanOpen(false); queryClient.invalidateQueries({ queryKey: ['commission-plans'] }); }}
        />
      )}
      {drawDrawerPlanId && (
        <DrawDrawer
          planId={drawDrawerPlanId}
          onClose={() => setDrawDrawerPlanId(null)}
          onIssued={() => { setDrawDrawerPlanId(null); queryClient.invalidateQueries({ queryKey: ['commission-records'] }); }}
        />
      )}
      {disputeDrawerRecordId && (
        <DisputeDrawer
          recordId={disputeDrawerRecordId}
          onClose={() => setDisputeDrawerRecordId(null)}
          onCreated={() => { setDisputeDrawerRecordId(null); queryClient.invalidateQueries({ queryKey: ['commission-disputes'] }); }}
        />
      )}
    </div>
  );
}

function PlansTab({ data, loading, error, onDraw, canManage }: { data: any[] | undefined; loading: boolean; error: boolean; onDraw: (id: string) => void; canManage: boolean }) {
  if (loading) return <PageLoader page="Commission plans" service="payroll-service" port={3012} />;
  if (error) return <Banner kind="error" testId="commission-plans-error" title="Unable to load commission plans">The payroll service could not be reached. Try again.</Banner>;
  const plans = data ?? [];
  if (plans.length === 0) return <EmptyState testId="commission-plans-empty" title="No commission plans" message="Create a tenant-configured commission plan to begin S109 tracking." />;
  return (
    <FinancialTable testId="commission-plans-table">
      <ReportThead>
        <ReportTh>Employee</ReportTh>
        <ReportTh>Type</ReportTh>
        <ReportTh>Rate</ReportTh>
        <ReportTh>Splits</ReportTh>
        <ReportTh>Draw</ReportTh>
        <ReportTh>Min. guarantee</ReportTh>
        <ReportTh>Status</ReportTh>
        <ReportTh>Actions</ReportTh>
      </ReportThead>
      <tbody>
        {plans.map((p: any) => (
          <ReportTr key={p.id} testId={`commission-plan-row-${p.id}`}>
            <ReportTd>{p.employee_id ?? p.employeeId}</ReportTd>
            <ReportTd>{p.plan_type ?? p.planType}</ReportTd>
            <ReportTd>{p.percentage_rate ?? p.flat_amount ?? '—'}</ReportTd>
            <ReportTd>{(p.split_rules ?? p.splitRules ?? []).length || '—'}</ReportTd>
            <ReportTd>{p.draw_amount ?? p.drawAmount ?? '—'}</ReportTd>
            <ReportTd>{p.minimum_guarantee ?? p.minimumGuarantee ?? '—'}</ReportTd>
            <ReportTd><StatusBadge status={p.is_active ?? p.isActive ? 'ACTIVE' : 'SUPERSEDED'} /></ReportTd>
            <ReportTd>
              <Btn variant="ghost" size="sm" disabled={!canManage} title={!canManage ? 'Requires payroll.commission.manage permission' : undefined} data-testid={`commission-plan-draw-${p.id}`} onClick={() => onDraw(p.id)}>Issue draw</Btn>
            </ReportTd>
          </ReportTr>
        ))}
      </tbody>
    </FinancialTable>
  );
}

function RecordsTab({ data, loading, error, act, onDispute, canManage }: {
  data: any[] | undefined; loading: boolean; error: boolean;
  act: (fn: () => Promise<any>, keys: string[]) => Promise<void>;
  onDispute: (id: string) => void;
  canManage: boolean;
}) {
  if (loading) return <PageLoader page="Commission register" service="payroll-service" port={3012} />;
  if (error) return <Banner kind="error" testId="commission-records-error" title="Unable to load commission records">The payroll service could not be reached. Try again.</Banner>;
  const records = data ?? [];
  if (records.length === 0) return <EmptyState testId="commission-records-empty" title="No commission records" message="Commission records appear here once calculated against a deal." />;
  return (
    <FinancialTable testId="commission-records-table">
      <ReportThead>
        <ReportTh>Employee</ReportTh>
        <ReportTh>Deal</ReportTh>
        <ReportTh>Amount</ReportTh>
        <ReportTh>Earned/Paid</ReportTh>
        <ReportTh>Clawed back</ReportTh>
        <ReportTh>Status</ReportTh>
        <ReportTh>Actions</ReportTh>
      </ReportThead>
      <tbody>
        {records.map((r: any) => (
          <ReportTr key={r.id} testId={`commission-record-row-${r.id}`}>
            <ReportTd>{r.employee_id ?? r.employeeId}</ReportTd>
            <ReportTd>{r.deal_id ?? r.dealId ?? r.deal_type ?? r.dealType}</ReportTd>
            <ReportTd>{r.commission_amount ?? r.commissionAmount}</ReportTd>
            <ReportTd><StatusBadge status={r.status} /></ReportTd>
            <ReportTd>{r.clawed_back_amount ?? r.clawedBackAmount ?? 0}</ReportTd>
            <ReportTd><StatusBadge status={r.status} /></ReportTd>
            <ReportTd>
              <div className="flex gap-1">
                <Btn variant="ghost" size="sm" disabled={!canManage} title={!canManage ? 'Requires payroll.commission.manage permission' : undefined} data-testid={`commission-record-mark-paid-${r.id}`} onClick={() => act(() => payrollApi.markCommissionPaid(r.id), ['commission-records'])}>Mark paid</Btn>
                <Btn variant="ghost" size="sm" disabled={!canManage} title={!canManage ? 'Requires payroll.commission.manage permission' : undefined} data-testid={`commission-record-dispute-${r.id}`} onClick={() => onDispute(r.id)}>Dispute</Btn>
                <Btn variant="ghost" size="sm" disabled={!canManage} title={!canManage ? 'Requires payroll.commission.manage permission' : undefined} data-testid={`commission-record-reverse-${r.id}`} onClick={() => act(() => payrollApi.reverseCommission(r.id, { reason: 'user-initiated reversal' }), ['commission-records'])}>Reverse</Btn>
              </div>
            </ReportTd>
          </ReportTr>
        ))}
      </tbody>
    </FinancialTable>
  );
}

function DisputesTab({ data, loading, error, act, canResolve }: {
  data: any[] | undefined; loading: boolean; error: boolean;
  act: (fn: () => Promise<any>, keys: string[]) => Promise<void>;
  canResolve: boolean;
}) {
  if (loading) return <PageLoader page="Commission disputes" service="payroll-service" port={3012} />;
  if (error) return <Banner kind="error" testId="commission-disputes-error" title="Unable to load disputes">The payroll service could not be reached. Try again.</Banner>;
  const disputes = data ?? [];
  if (disputes.length === 0) return <EmptyState testId="commission-disputes-empty" title="No disputes" message="Commission disputes raised against a record appear here for review and resolution." />;
  return (
    <FinancialTable testId="commission-disputes-table">
      <ReportThead>
        <ReportTh>Commission record</ReportTh>
        <ReportTh>Raised by</ReportTh>
        <ReportTh>Reason</ReportTh>
        <ReportTh>Status</ReportTh>
        <ReportTh>Actions</ReportTh>
      </ReportThead>
      <tbody>
        {disputes.map((d: any) => (
          <ReportTr key={d.id} testId={`commission-dispute-row-${d.id}`}>
            <ReportTd>{d.commission_record_id ?? d.commissionRecordId}</ReportTd>
            <ReportTd>{d.raised_by ?? d.raisedBy}</ReportTd>
            <ReportTd>{d.reason}</ReportTd>
            <ReportTd><StatusBadge status={d.status} /></ReportTd>
            <ReportTd>
              {d.status === 'OPEN' && (
                <div className="flex gap-1">
                  <Btn variant="ghost" size="sm" disabled={!canResolve} title={!canResolve ? 'Requires payroll.commission_dispute.resolve permission' : undefined} data-testid={`commission-dispute-approve-${d.id}`} onClick={() => act(() => payrollApi.resolveCommissionDispute(d.id, { resolution: 'APPROVE_ADJUSTMENT' }), ['commission-disputes'])}>Approve adjustment</Btn>
                  <Btn variant="ghost" size="sm" disabled={!canResolve} title={!canResolve ? 'Requires payroll.commission_dispute.resolve permission' : undefined} data-testid={`commission-dispute-deny-${d.id}`} onClick={() => act(() => payrollApi.resolveCommissionDispute(d.id, { resolution: 'DENY' }), ['commission-disputes'])}>Deny</Btn>
                </div>
              )}
            </ReportTd>
          </ReportTr>
        ))}
      </tbody>
    </FinancialTable>
  );
}

function NewPlanDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [employeeId, setEmployeeId] = useState('');
  const [planType, setPlanType] = useState<'FLAT' | 'PERCENTAGE' | 'TIERED'>('PERCENTAGE');
  const [rate, setRate] = useState('');
  const [drawAmount, setDrawAmount] = useState('');
  const [minimumGuarantee, setMinimumGuarantee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: any = {
        employee_id: employeeId,
        plan_type: planType,
        effective_date: new Date().toISOString().slice(0, 10),
      };
      if (planType === 'PERCENTAGE') payload.percentage_rate = Number(rate);
      if (planType === 'FLAT') payload.flat_amount = Number(rate);
      if (drawAmount) payload.draw_amount = Number(drawAmount);
      if (minimumGuarantee) payload.minimum_guarantee = Number(minimumGuarantee);
      await payrollApi.createCommissionPlan(payload);
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="New commission plan"
      subtitle="All rates, draws and guarantees are tenant-configured — never hardcoded."
      testId="commission-new-plan-drawer"
      actions={
        <>
          <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" size="sm" data-testid="commission-new-plan-submit" disabled={!employeeId || !rate || submitting} onClick={submit}>Create plan</Btn>
        </>
      }
    >
      {error && <Banner kind="error" testId="commission-new-plan-error" title="Could not create plan">{error}</Banner>}
      <label className="block text-[12px] font-medium text-slate-600 mb-1 mt-2">Employee ID</label>
      <input className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm mb-3" data-testid="commission-new-plan-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />

      <label className="block text-[12px] font-medium text-slate-600 mb-1">Plan type</label>
      <select className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm mb-3" data-testid="commission-new-plan-type" value={planType} onChange={(e) => setPlanType(e.target.value as any)}>
        <option value="PERCENTAGE">PERCENTAGE</option>
        <option value="FLAT">FLAT</option>
        <option value="TIERED">TIERED</option>
      </select>

      <label className="block text-[12px] font-medium text-slate-600 mb-1">{planType === 'PERCENTAGE' ? 'Percentage rate' : 'Flat amount'}</label>
      <input type="number" className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm mb-3" data-testid="commission-new-plan-rate" value={rate} onChange={(e) => setRate(e.target.value)} />

      <label className="block text-[12px] font-medium text-slate-600 mb-1">Draw amount (optional)</label>
      <input type="number" className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm mb-3" data-testid="commission-new-plan-draw" value={drawAmount} onChange={(e) => setDrawAmount(e.target.value)} />

      <label className="block text-[12px] font-medium text-slate-600 mb-1">Minimum guarantee (optional)</label>
      <input type="number" className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" data-testid="commission-new-plan-guarantee" value={minimumGuarantee} onChange={(e) => setMinimumGuarantee(e.target.value)} />
    </Drawer>
  );
}

function DrawDrawer({ planId, onClose, onIssued }: { planId: string; onClose: () => void; onIssued: () => void }) {
  const [employeeId, setEmployeeId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      await payrollApi.issueCommissionDraw(planId, { employeeId, amount: Number(amount) });
      onIssued();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Issue draw"
      subtitle="Draws recover against future earned commissions."
      testId="commission-draw-drawer"
      actions={
        <>
          <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" size="sm" data-testid="commission-draw-submit" disabled={!employeeId || !amount || submitting} onClick={submit}>Issue draw</Btn>
        </>
      }
    >
      {error && <Banner kind="error" testId="commission-draw-error" title="Could not issue draw">{error}</Banner>}
      <DrawerRow label="Plan" value={planId} />
      <label className="block text-[12px] font-medium text-slate-600 mb-1 mt-3">Employee ID</label>
      <input className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm mb-3" data-testid="commission-draw-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} />
      <label className="block text-[12px] font-medium text-slate-600 mb-1">Amount</label>
      <input type="number" className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" data-testid="commission-draw-amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
    </Drawer>
  );
}

function DisputeDrawer({ recordId, onClose, onCreated }: { recordId: string; onClose: () => void; onCreated: () => void }) {
  const [reason, setReason] = useState('');
  const [adjustedAmount, setAdjustedAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const payload: any = { reason };
      if (adjustedAmount) payload.adjustedAmount = Number(adjustedAmount);
      await payrollApi.createCommissionDispute(recordId, payload);
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Raise dispute"
      subtitle="Disputes must be resolved by a different user than the one who raised them (SoD-enforced)."
      testId="commission-dispute-drawer"
      actions={
        <>
          <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" size="sm" data-testid="commission-dispute-submit" disabled={!reason || submitting} onClick={submit}>Raise dispute</Btn>
        </>
      }
    >
      {error && <Banner kind="error" testId="commission-dispute-error" title="Could not raise dispute">{error}</Banner>}
      <DrawerRow label="Commission record" value={recordId} />
      <label className="block text-[12px] font-medium text-slate-600 mb-1 mt-3">Reason</label>
      <textarea className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm mb-3" data-testid="commission-dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      <label className="block text-[12px] font-medium text-slate-600 mb-1">Requested adjusted amount (optional)</label>
      <input type="number" className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm" data-testid="commission-dispute-amount" value={adjustedAmount} onChange={(e) => setAdjustedAmount(e.target.value)} />
    </Drawer>
  );
}

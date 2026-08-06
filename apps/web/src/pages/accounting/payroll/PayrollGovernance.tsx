import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '../../../api/client';
import { PageHeader, Btn } from '../../../components/ui';
import StatusBadge from '../../../components/StatusBadge';
import PageLoader from '../../../components/PageLoader';
import { Banner, EmptyState, FinancialTable, ReportThead, ReportTh, ReportTr, ReportTd } from '../../../components/report';
import { hasPayrollPermission, parsePayrollPermissions, PAYROLL_PERMISSIONS } from './payrollPermissions';

type Tab = 'source-mode' | 'rule-packs' | 'clawbacks' | 'accruals' | 'tech-bridge';

// CE-13 governance console — statutory-source boundary configuration
// (S108), rule-pack draft/simulate/validate/activate governance (S025,
// author != activator enforced server-side), commission clawback/
// chargeback queue (S110), accrual approval queue with self-approval
// denial (S111), and the tech-role flag/hour bridge with deterministic
// RATE_GAP refusal (S112). Consolidated into one screen per story family
// so every mandated surface is reachable from the unified Accounting
// application without a separate Payroll shell.
export default function PayrollGovernance() {
  const [tab, setTab] = useState<Tab>('source-mode');
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const permissions = parsePayrollPermissions();
  const canManageSourceMode = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.SOURCE_MODE_MANAGE);
  const canManageRulePacks = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.RULE_PACK_MANAGE);
  const canActivateRulePacks = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.RULE_PACK_ACTIVATE);
  const canManageClawbacks = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.CLAWBACK_MANAGE);
  const canApproveAccruals = hasPayrollPermission(permissions, PAYROLL_PERMISSIONS.ACCRUAL_APPROVE);

  const sourceModeQuery = useQuery({ queryKey: ['payroll-source-mode'], queryFn: () => payrollApi.getSourceMode(), retry: false });
  const rulePacksQuery = useQuery({ queryKey: ['payroll-rule-packs'], queryFn: () => payrollApi.listRulePacks(), retry: false, enabled: tab === 'rule-packs' });
  const clawbacksQuery = useQuery({ queryKey: ['payroll-clawbacks'], queryFn: () => payrollApi.listClawbacks(), retry: false, enabled: tab === 'clawbacks' });
  const accrualsQuery = useQuery({ queryKey: ['payroll-accruals'], queryFn: () => payrollApi.listAccruals(), retry: false, enabled: tab === 'accruals' });
  const techBridgeQuery = useQuery({ queryKey: ['payroll-tech-bridge'], queryFn: () => payrollApi.listTechBridge(), retry: false, enabled: tab === 'tech-bridge' });

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
    <div className="p-7 min-h-full" data-testid="payroll-governance-page">
      <PageHeader title="Payroll Governance" subtitle="Statutory-source config, rule-pack activation, clawbacks, accruals, and the tech flag/hour bridge (CE-13)." />

      {actionError && <Banner kind="error" testId="payroll-governance-action-error" title="Action failed">{actionError}</Banner>}

      <div className="flex items-center gap-1 border-b border-slate-200 mt-6 mb-4 flex-wrap">
        {(['source-mode', 'rule-packs', 'clawbacks', 'accruals', 'tech-bridge'] as Tab[]).map((t) => (
          <button key={t} className={`px-3 py-2 text-[13px] font-semibold border-b-2 capitalize ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-500'}`} onClick={() => setTab(t)} data-testid={`payroll-gov-tab-${t}`}>
            {t.replace('-', ' ')}
          </button>
        ))}
      </div>

      {tab === 'source-mode' && (
        sourceModeQuery.isLoading ? <PageLoader page="Source mode" service="payroll-service" port={3012} /> :
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6" data-testid="payroll-source-mode-card">
          <p className="text-sm text-slate-600 mb-3">
            Current mode: <StatusBadge status={sourceModeQuery.data?.payrollSourceMode ?? 'NOT_CONFIGURED'} />
          </p>
          <p className="text-xs text-slate-500 mb-3">
            NOT_CONFIGURED (default) blocks all withholding at validation. ATTESTED_MANUAL_ENTRY accepts figures entered from a
            provider payroll register with an attester and source-document reference. TEST_FIXTURE is refused outside the
            certification-only test tenant and always returns productionCertified:false — it can never be used in production.
          </p>
          <div className="flex gap-2">
            <Btn variant="secondary" size="sm" disabled={!canManageSourceMode} title={!canManageSourceMode ? 'Requires payroll.source_mode.manage permission' : undefined} data-testid="payroll-source-mode-not-configured-btn" onClick={() => act(() => payrollApi.setSourceMode('NOT_CONFIGURED'), ['payroll-source-mode'])}>NOT_CONFIGURED</Btn>
            <Btn variant="secondary" size="sm" disabled={!canManageSourceMode} title={!canManageSourceMode ? 'Requires payroll.source_mode.manage permission' : undefined} data-testid="payroll-source-mode-attested-btn" onClick={() => act(() => payrollApi.setSourceMode('ATTESTED_MANUAL_ENTRY'), ['payroll-source-mode'])}>ATTESTED_MANUAL_ENTRY</Btn>
            <Btn variant="secondary" size="sm" disabled={!canManageSourceMode} title={!canManageSourceMode ? 'Requires payroll.source_mode.manage permission' : undefined} data-testid="payroll-source-mode-test-fixture-btn" onClick={() => act(() => payrollApi.setSourceMode('TEST_FIXTURE'), ['payroll-source-mode'])}>TEST_FIXTURE (cert-tenant only)</Btn>
          </div>
        </div>
      )}

      {tab === 'rule-packs' && (
        <RulePacksTab data={rulePacksQuery.data} loading={rulePacksQuery.isLoading} act={act} canActivate={canActivateRulePacks} />
      )}
      {tab === 'clawbacks' && (
        <ListTab
          testId="payroll-clawbacks"
          data={clawbacksQuery.data}
          loading={clawbacksQuery.isLoading}
          columns={['id', 'employeeId', 'amount', 'reason', 'status']}
          emptyMessage="No clawback/chargeback records."
          onResolve={canManageClawbacks ? (id) => act(() => payrollApi.resolveClawback(id), ['payroll-clawbacks']) : undefined}
        />
      )}
      {tab === 'accruals' && (
        <ListTab
          testId="payroll-accruals"
          data={accrualsQuery.data}
          loading={accrualsQuery.isLoading}
          columns={['id', 'accrualType', 'amount', 'periodEnd', 'status']}
          emptyMessage="No accrual entries."
          onResolve={canApproveAccruals ? (id) => act(() => payrollApi.approveAccrual(id), ['payroll-accruals']) : undefined}
          resolveLabel="Approve"
        />
      )}
      {tab === 'tech-bridge' && (
        <ListTab
          testId="payroll-tech-bridge"
          data={techBridgeQuery.data}
          loading={techBridgeQuery.isLoading}
          columns={['id', 'employeeId', 'flagHours', 'status']}
          emptyMessage="No tech flag/hour bridge entries. RATE_GAP entries are refused deterministically until a flag rate is configured — never silently estimated."
        />
      )}
    </div>
  );
}

function RulePacksTab({ data, loading, act, canActivate }: { data: any[] | undefined; loading: boolean; act: (fn: () => Promise<any>, keys: string[]) => Promise<void>; canActivate: boolean }) {
  if (loading) return <PageLoader page="Rule packs" service="payroll-service" port={3012} />;
  const packs = data ?? [];
  if (packs.length === 0) return <EmptyState testId="payroll-rule-packs-empty" title="No rule packs" message="Create a draft rule pack to begin S025 governance." />;
  return (
    <FinancialTable testId="payroll-rule-packs-table">
      <ReportThead>
        <ReportTh>Pack key</ReportTh>
        <ReportTh>Version</ReportTh>
        <ReportTh>Status</ReportTh>
        <ReportTh>Created by</ReportTh>
        <ReportTh>Actions</ReportTh>
      </ReportThead>
      <tbody>
        {packs.map((p: any) => (
          <ReportTr key={p.id} testId={`payroll-rule-pack-row-${p.id}`}>
            <ReportTd>{p.packKey}</ReportTd>
            <ReportTd>{p.version}</ReportTd>
            <ReportTd><StatusBadge status={p.status} /></ReportTd>
            <ReportTd>{p.createdBy}</ReportTd>
            <ReportTd>
              <div className="flex gap-1">
                <Btn variant="ghost" size="sm" data-testid={`payroll-rule-pack-validate-${p.id}`} onClick={() => act(() => payrollApi.validateRulePack(p.id), ['payroll-rule-packs'])}>Validate</Btn>
                <Btn variant="ghost" size="sm" disabled={!canActivate} title={!canActivate ? 'Requires payroll.rule_pack.activate permission' : undefined} data-testid={`payroll-rule-pack-activate-${p.id}`} onClick={() => act(() => payrollApi.activateRulePack(p.id), ['payroll-rule-packs'])}>Activate</Btn>
              </div>
            </ReportTd>
          </ReportTr>
        ))}
      </tbody>
    </FinancialTable>
  );
}

function ListTab({ testId, data, loading, columns, emptyMessage, onResolve, resolveLabel = 'Resolve' }: {
  testId: string; data: any[] | undefined; loading: boolean; columns: string[]; emptyMessage: string;
  onResolve?: (id: string) => void; resolveLabel?: string;
}) {
  if (loading) return <PageLoader page={testId} service="payroll-service" port={3012} />;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState testId={`${testId}-empty`} title="Nothing here yet" message={emptyMessage} />;
  return (
    <FinancialTable testId={`${testId}-table`}>
      <ReportThead>
        {columns.map((c) => <ReportTh key={c}>{c}</ReportTh>)}
        {onResolve && <ReportTh>Actions</ReportTh>}
      </ReportThead>
      <tbody>
        {rows.map((r: any) => (
          <ReportTr key={r.id} testId={`${testId}-row-${r.id}`}>
            {columns.map((c) => <ReportTd key={c}>{typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '—')}</ReportTd>)}
            {onResolve && (
              <ReportTd>
                <Btn variant="ghost" size="sm" data-testid={`${testId}-resolve-${r.id}`} onClick={() => onResolve(r.id)}>{resolveLabel}</Btn>
              </ReportTd>
            )}
          </ReportTr>
        ))}
      </tbody>
    </FinancialTable>
  );
}

/**
 * CE-13 — Payroll Governance UI tests (S108/S025/S110/S111/S112). Covers
 * source-mode config, rule-pack validate/activate, clawback resolve,
 * accrual approve, tech-bridge RATE_GAP display, and empty states across
 * tabs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollGovernance from './PayrollGovernance';
import { payrollApi } from '../../../api/client';
import { PAYROLL_PERMISSIONS } from './payrollPermissionKeys';

vi.mock('../../../api/client', () => ({
  payrollApi: {
    getSourceMode: vi.fn(),
    setSourceMode: vi.fn(),
    listRulePacks: vi.fn(),
    validateRulePack: vi.fn(),
    activateRulePack: vi.fn(),
    listClawbacks: vi.fn(),
    resolveClawback: vi.fn(),
    listAccruals: vi.fn(),
    approveAccrual: vi.fn(),
    listTechBridge: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/accounting/payroll/governance']}>
        <PayrollGovernance />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PayrollGovernance', () => {
  // CE-13 RBAC gap-closure: existing tests exercise actions as a fully
  // permissioned user by default (server-side enforcement is what's
  // authoritative — see test-payroll-authz.ts on the payroll-service side).
  // A dedicated describe block below tests the unauthorized/disabled state.
  beforeEach(() => {
    localStorage.setItem('userPermissions', JSON.stringify(Object.values(PAYROLL_PERMISSIONS)));
  });

  it('renders the source-mode card (happy render)', async () => {
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'NOT_CONFIGURED', updatedBy: null, updatedAt: null });
    renderPage();
    expect(await screen.findByTestId('payroll-source-mode-card')).toBeInTheDocument();
  });

  it('configures the source mode to ATTESTED_MANUAL_ENTRY', async () => {
    const user = userEvent.setup();
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'NOT_CONFIGURED', updatedBy: null, updatedAt: null });
    (payrollApi.setSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY' });
    renderPage();

    await screen.findByTestId('payroll-source-mode-card');
    await user.click(screen.getByTestId('payroll-source-mode-attested-btn'));
    await waitFor(() => expect(payrollApi.setSourceMode).toHaveBeenCalledWith('ATTESTED_MANUAL_ENTRY'));
  });

  it('validates and activates a rule pack (author != activator enforced server-side)', async () => {
    const user = userEvent.setup();
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'a', updatedAt: null });
    (payrollApi.listRulePacks as any).mockResolvedValue([{ id: 'v1', packKey: 'payroll-gl-mapping', version: 1, status: 'DRAFT', createdBy: 'author-1' }]);
    (payrollApi.validateRulePack as any).mockResolvedValue({ valid: true });
    (payrollApi.activateRulePack as any).mockResolvedValue({ status: 'ACTIVE' });
    renderPage();

    await screen.findByTestId('payroll-source-mode-card');
    await user.click(screen.getByTestId('payroll-gov-tab-rule-packs'));
    expect(await screen.findByTestId('payroll-rule-packs-table')).toBeInTheDocument();
    await user.click(screen.getByTestId('payroll-rule-pack-validate-v1'));
    await waitFor(() => expect(payrollApi.validateRulePack).toHaveBeenCalledWith('v1'));
    await user.click(screen.getByTestId('payroll-rule-pack-activate-v1'));
    await waitFor(() => expect(payrollApi.activateRulePack).toHaveBeenCalledWith('v1'));
  });

  it('shows the empty state when there are no rule packs', async () => {
    const user = userEvent.setup();
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'a', updatedAt: null });
    (payrollApi.listRulePacks as any).mockResolvedValue([]);
    renderPage();
    await screen.findByTestId('payroll-source-mode-card');
    await user.click(screen.getByTestId('payroll-gov-tab-rule-packs'));
    expect(await screen.findByTestId('payroll-rule-packs-empty')).toBeInTheDocument();
  });

  it('resolves a clawback', async () => {
    const user = userEvent.setup();
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'a', updatedAt: null });
    (payrollApi.listClawbacks as any).mockResolvedValue([{ id: 'cb-1', employeeId: 'emp-1', amount: 100, reason: 'overpayment', status: 'OPEN' }]);
    (payrollApi.resolveClawback as any).mockResolvedValue({ status: 'RESOLVED' });
    renderPage();

    await screen.findByTestId('payroll-source-mode-card');
    await user.click(screen.getByTestId('payroll-gov-tab-clawbacks'));
    await user.click(screen.getByTestId('payroll-clawbacks-resolve-cb-1'));
    await waitFor(() => expect(payrollApi.resolveClawback).toHaveBeenCalledWith('cb-1'));
  });

  it('approves an accrual', async () => {
    const user = userEvent.setup();
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'a', updatedAt: null });
    (payrollApi.listAccruals as any).mockResolvedValue([{ id: 'acc-1', accrualType: 'BONUS_ACCRUAL', amount: 500, periodEnd: '2024-01-31', status: 'PREVIEW' }]);
    (payrollApi.approveAccrual as any).mockResolvedValue({ status: 'APPROVED' });
    renderPage();

    await screen.findByTestId('payroll-source-mode-card');
    await user.click(screen.getByTestId('payroll-gov-tab-accruals'));
    await user.click(screen.getByTestId('payroll-accruals-resolve-acc-1'));
    await waitFor(() => expect(payrollApi.approveAccrual).toHaveBeenCalledWith('acc-1'));
  });

  it('shows tech-bridge RATE_GAP entries without a resolve action (deterministic refusal, never estimated)', async () => {
    const user = userEvent.setup();
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'a', updatedAt: null });
    (payrollApi.listTechBridge as any).mockResolvedValue([{ id: 'tb-1', employeeId: 'emp-1', flagHours: 40, status: 'RATE_GAP' }]);
    renderPage();

    await screen.findByTestId('payroll-source-mode-card');
    await user.click(screen.getByTestId('payroll-gov-tab-tech-bridge'));
    expect(await screen.findByTestId('payroll-tech-bridge-table')).toBeInTheDocument();
    expect(screen.queryByTestId('payroll-tech-bridge-resolve-tb-1')).not.toBeInTheDocument();
  });
});

describe('PayrollGovernance — unauthorized UI reflection (CE-13 RBAC gap-closure)', () => {
  // Server-side attachPayrollRouteSecurity() is authoritative (proven in
  // payroll-service/src/tests/test-payroll-authz.ts) — this only proves the
  // UI reflects an unauthorized user by disabling the action, not hiding
  // functionality a user with the missing permission cannot invoke.
  it('disables source-mode, rule-pack-activate, clawback-resolve, and accrual-approve actions when the corresponding permission is absent', async () => {
    localStorage.setItem('userPermissions', JSON.stringify([]));
    const user = userEvent.setup();
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'NOT_CONFIGURED', updatedBy: null, updatedAt: null });
    (payrollApi.listRulePacks as any).mockResolvedValue([{ id: 'v1', packKey: 'k', version: 1, status: 'VALIDATED', createdBy: 'u1' }]);
    (payrollApi.listClawbacks as any).mockResolvedValue([{ id: 'cb-1', employeeId: 'e1', amount: 100, reason: 'r', status: 'PENDING' }]);
    (payrollApi.listAccruals as any).mockResolvedValue([{ id: 'acc-1', accrualType: 'BONUS_ACCRUAL', amount: 500, periodEnd: '2024-01-31', status: 'PREVIEW' }]);
    renderPage();

    await screen.findByTestId('payroll-source-mode-card');
    expect(screen.getByTestId('payroll-source-mode-attested-btn')).toBeDisabled();

    await user.click(screen.getByTestId('payroll-gov-tab-rule-packs'));
    expect(await screen.findByTestId('payroll-rule-pack-activate-v1')).toBeDisabled();

    await user.click(screen.getByTestId('payroll-gov-tab-clawbacks'));
    expect(await screen.findByTestId('payroll-clawbacks-table')).toBeInTheDocument();
    expect(screen.queryByTestId('payroll-clawbacks-resolve-cb-1')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('payroll-gov-tab-accruals'));
    expect(await screen.findByTestId('payroll-accruals-table')).toBeInTheDocument();
    expect(screen.queryByTestId('payroll-accruals-resolve-acc-1')).not.toBeInTheDocument();
  });
});

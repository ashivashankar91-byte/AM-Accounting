/**
 * CE-13 / S109 — Commission, Draws & Disputes UI tests. Covers plans list
 * happy render/empty, creating a tenant-configured plan, issuing a draw,
 * marking paid, reversing a record, raising and resolving a dispute, and
 * API-error states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollCommissionWorkbench from './PayrollCommissionWorkbench';
import { payrollApi } from '../../../api/client';
import { PAYROLL_PERMISSIONS } from './payrollPermissionKeys';

vi.mock('../../../api/client', () => ({
  payrollApi: {
    listCommissionPlans: vi.fn(),
    createCommissionPlan: vi.fn(),
    issueCommissionDraw: vi.fn(),
    listCommissions: vi.fn(),
    markCommissionPaid: vi.fn(),
    reverseCommission: vi.fn(),
    createCommissionDispute: vi.fn(),
    listCommissionDisputes: vi.fn(),
    resolveCommissionDispute: vi.fn(),
    getCommissionDetail: vi.fn(),
  },
}));

// fix(integration) — CE-13 UI closure: the commission workbench now reads
// the selected legal entity to thread legal_entity_id into new plans (see
// EntityScopeContext.tsx). Mirrors the established mock convention in e.g.
// WipOpenRoReport.test.tsx.
vi.mock('../../../context/EntityScopeContext', () => ({
  useEntityScope: () => ({
    entityId: 'entity-1', entityLabel: 'CE13-A — CE13 Cert Legal Entity A', storeId: null, consolidated: false,
    entities: [{ id: 'entity-1', entityCode: 'CE13-A', legalName: 'CE13 Cert Legal Entity A' }],
    loading: false, noEntitiesConfigured: false, error: null,
    setEntity: vi.fn(), setStore: vi.fn(), setConsolidated: vi.fn(),
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/accounting/payroll/commissions']}>
        <PayrollCommissionWorkbench />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PLAN = { id: 'plan-1', employee_id: 'emp-1', plan_type: 'PERCENTAGE', percentage_rate: 5, split_rules: [], is_active: true };
const RECORD = { id: 'rec-1', employee_id: 'emp-1', deal_id: 'deal-1', commission_amount: 100, status: 'EARNED', clawed_back_amount: 0 };
const DISPUTE = { id: 'dispute-1', commission_record_id: 'rec-1', raised_by: 'raiser-1', reason: 'incorrect tier', status: 'OPEN' };

describe('PayrollCommissionWorkbench', () => {
  beforeEach(() => {
    localStorage.setItem('userPermissions', JSON.stringify(Object.values(PAYROLL_PERMISSIONS)));
  });

  it('renders the plans table (happy render)', async () => {
    (payrollApi.listCommissionPlans as any).mockResolvedValue([PLAN]);
    renderPage();
    expect(await screen.findByTestId('commission-plans-table')).toBeInTheDocument();
    expect(screen.getByText('emp-1')).toBeInTheDocument();
  });

  it('shows the empty state with no plans', async () => {
    (payrollApi.listCommissionPlans as any).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByTestId('commission-plans-empty')).toBeInTheDocument();
  });

  it('shows an error state when plans fail to load', async () => {
    (payrollApi.listCommissionPlans as any).mockRejectedValue(new Error('network error'));
    renderPage();
    expect(await screen.findByTestId('commission-plans-error')).toBeInTheDocument();
  });

  it('creates a tenant-configured commission plan (never hardcoding a rate)', async () => {
    const user = userEvent.setup();
    (payrollApi.listCommissionPlans as any).mockResolvedValue([]);
    (payrollApi.createCommissionPlan as any).mockResolvedValue({ ...PLAN });
    renderPage();

    await screen.findByTestId('commission-plans-empty');
    await user.click(screen.getByTestId('commission-new-plan-btn'));
    await user.type(screen.getByTestId('commission-new-plan-employee'), 'emp-2');
    await user.type(screen.getByTestId('commission-new-plan-rate'), '7');
    await user.click(screen.getByTestId('commission-new-plan-submit'));
    await waitFor(() => expect(payrollApi.createCommissionPlan).toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: 'emp-2', plan_type: 'PERCENTAGE', percentage_rate: 7 }),
    ));
  });

  it('issues a draw against a plan', async () => {
    const user = userEvent.setup();
    (payrollApi.listCommissionPlans as any).mockResolvedValue([PLAN]);
    (payrollApi.issueCommissionDraw as any).mockResolvedValue({ id: 'draw-1' });
    renderPage();

    await screen.findByTestId('commission-plans-table');
    await user.click(screen.getByTestId('commission-plan-draw-plan-1'));
    await user.type(screen.getByTestId('commission-draw-employee'), 'emp-1');
    await user.type(screen.getByTestId('commission-draw-amount'), '300');
    await user.click(screen.getByTestId('commission-draw-submit'));
    await waitFor(() => expect(payrollApi.issueCommissionDraw).toHaveBeenCalledWith('plan-1', { employeeId: 'emp-1', amount: 300 }));
  });

  it('renders records, marks paid and reverses a record', async () => {
    const user = userEvent.setup();
    (payrollApi.listCommissions as any).mockResolvedValue([RECORD]);
    (payrollApi.markCommissionPaid as any).mockResolvedValue({ ...RECORD, status: 'PAID' });
    (payrollApi.reverseCommission as any).mockResolvedValue({ id: 'rec-2', deal_type: 'REVERSAL_OF:rec-1' });
    (payrollApi.listCommissionPlans as any).mockResolvedValue([]);
    renderPage();

    await user.click(screen.getByTestId('commission-tab-records'));
    expect(await screen.findByTestId('commission-records-table')).toBeInTheDocument();
    await user.click(screen.getByTestId('commission-record-mark-paid-rec-1'));
    await waitFor(() => expect(payrollApi.markCommissionPaid).toHaveBeenCalledWith('rec-1'));
    await user.click(screen.getByTestId('commission-record-reverse-rec-1'));
    await waitFor(() => expect(payrollApi.reverseCommission).toHaveBeenCalled());
  });

  it('raises a dispute from a commission record', async () => {
    const user = userEvent.setup();
    (payrollApi.listCommissions as any).mockResolvedValue([RECORD]);
    (payrollApi.createCommissionDispute as any).mockResolvedValue({ ...DISPUTE });
    (payrollApi.listCommissionPlans as any).mockResolvedValue([]);
    renderPage();

    await user.click(screen.getByTestId('commission-tab-records'));
    await screen.findByTestId('commission-records-table');
    await user.click(screen.getByTestId('commission-record-dispute-rec-1'));
    await user.type(screen.getByTestId('commission-dispute-reason'), 'incorrect tier applied');
    await user.click(screen.getByTestId('commission-dispute-submit'));
    await waitFor(() => expect(payrollApi.createCommissionDispute).toHaveBeenCalledWith('rec-1', expect.objectContaining({ reason: 'incorrect tier applied' })));
  });

  it('resolves an open dispute (distinct reviewer, server enforces SoD)', async () => {
    const user = userEvent.setup();
    (payrollApi.listCommissionDisputes as any).mockResolvedValue([DISPUTE]);
    (payrollApi.resolveCommissionDispute as any).mockResolvedValue({ ...DISPUTE, status: 'RESOLVED' });
    (payrollApi.listCommissionPlans as any).mockResolvedValue([]);
    renderPage();

    await user.click(screen.getByTestId('commission-tab-disputes'));
    expect(await screen.findByTestId('commission-disputes-table')).toBeInTheDocument();
    await user.click(screen.getByTestId('commission-dispute-approve-dispute-1'));
    await waitFor(() => expect(payrollApi.resolveCommissionDispute).toHaveBeenCalledWith('dispute-1', { resolution: 'APPROVE_ADJUSTMENT' }));
  });

  it('shows the empty state for disputes', async () => {
    const user = userEvent.setup();
    (payrollApi.listCommissionDisputes as any).mockResolvedValue([]);
    (payrollApi.listCommissionPlans as any).mockResolvedValue([]);
    renderPage();
    await user.click(screen.getByTestId('commission-tab-disputes'));
    expect(await screen.findByTestId('commission-disputes-empty')).toBeInTheDocument();
  });
});

describe('PayrollCommissionWorkbench — unauthorized UI reflection (CE-13 RBAC gap-closure)', () => {
  // Server-side attachPayrollRouteSecurity() is authoritative — this only
  // proves the UI disables New Plan/Issue draw/Mark paid/Reverse when
  // payroll.commission.manage is absent, and Approve/Deny when
  // payroll.commission_dispute.resolve is absent.
  it('disables commission-manage and dispute-resolve actions when the corresponding permission is absent', async () => {
    localStorage.setItem('userPermissions', JSON.stringify([]));
    const user = userEvent.setup();
    (payrollApi.listCommissionPlans as any).mockResolvedValue([PLAN]);
    (payrollApi.listCommissions as any).mockResolvedValue([RECORD]);
    (payrollApi.listCommissionDisputes as any).mockResolvedValue([DISPUTE]);
    renderPage();

    expect(await screen.findByTestId('commission-plans-table')).toBeInTheDocument();
    expect(screen.getByTestId('commission-new-plan-btn')).toBeDisabled();
    expect(screen.getByTestId('commission-plan-draw-plan-1')).toBeDisabled();

    await user.click(screen.getByTestId('commission-tab-records'));
    expect(await screen.findByTestId('commission-records-table')).toBeInTheDocument();
    expect(screen.getByTestId('commission-record-mark-paid-rec-1')).toBeDisabled();
    expect(screen.getByTestId('commission-record-reverse-rec-1')).toBeDisabled();

    await user.click(screen.getByTestId('commission-tab-disputes'));
    expect(await screen.findByTestId('commission-disputes-table')).toBeInTheDocument();
    expect(screen.getByTestId('commission-dispute-approve-dispute-1')).toBeDisabled();
    expect(screen.getByTestId('commission-dispute-deny-dispute-1')).toBeDisabled();
  });
});

// fix(integration) Gap 1.C — commission journal drill-down.
describe('PayrollCommissionWorkbench — commission journal drill-down', () => {
  beforeEach(() => {
    localStorage.setItem('userPermissions', JSON.stringify(Object.values(PAYROLL_PERMISSIONS)));
  });

  it('shows plan/batch/journal lineage without overwriting the original journal, including a separate reversal journal', async () => {
    const user = userEvent.setup();
    (payrollApi.listCommissions as any).mockResolvedValue([RECORD]);
    (payrollApi.getCommissionDetail as any).mockResolvedValue({
      id: 'rec-1', employee_id: 'emp-1', deal_id: 'deal-1', commission_amount: 100, status: 'EARNED',
      clawed_back_amount: 0, journal_entry_id: 'je-original', reversal_journal_entry_id: 'je-reversal',
      plan: { plan_type: 'FLAT', split_rules: null, draw_amount: 300, minimum_guarantee: 400, chargeback_terms: null },
      batch: { batch_number: 'PB-1001', status: 'VOID' },
      item: { commission_pay: 100, net_pay: 80 },
    });
    renderPage();
    await user.click(screen.getByTestId('commission-tab-records'));
    await user.click(await screen.findByTestId('commission-record-lineage-rec-1'));

    expect(await screen.findByTestId('commission-lineage-drawer')).toBeInTheDocument();
    expect(await screen.findByTestId('commission-lineage-original-journal')).toHaveTextContent('je-original');
    expect(screen.getByTestId('commission-lineage-reversal-journal')).toHaveTextContent('je-reversal');
    expect(screen.getByText(/PB-1001/)).toBeInTheDocument();
  });

  it('shows an honest "not yet posted" state when the record has no journal linkage — never a fabricated journal id', async () => {
    const user = userEvent.setup();
    (payrollApi.listCommissions as any).mockResolvedValue([RECORD]);
    (payrollApi.getCommissionDetail as any).mockResolvedValue({
      id: 'rec-1', employee_id: 'emp-1', deal_id: 'deal-1', commission_amount: 100, status: 'EARNED',
      clawed_back_amount: 0, journal_entry_id: null, reversal_journal_entry_id: null, plan: null, batch: null, item: null,
    });
    renderPage();
    await user.click(screen.getByTestId('commission-tab-records'));
    await user.click(await screen.findByTestId('commission-record-lineage-rec-1'));

    expect(await screen.findByTestId('commission-lineage-not-posted')).toBeInTheDocument();
    expect(screen.getByTestId('commission-lineage-no-plan')).toBeInTheDocument();
    expect(screen.getByTestId('commission-lineage-no-batch')).toBeInTheDocument();
    expect(screen.queryByTestId('commission-lineage-original-journal')).not.toBeInTheDocument();
  });
});

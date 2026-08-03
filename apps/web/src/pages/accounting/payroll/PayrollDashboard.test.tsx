/**
 * CE-13 — Payroll Dashboard UI tests. Covers happy render, statutory
 * source-not-configured banner, empty state, unauthorized state, batch
 * creation success, and duplicate-payroll (409) surfaced truthfully.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollDashboard from './PayrollDashboard';
import { payrollApi } from '../../../api/client';
import { PAYROLL_PERMISSIONS } from './payrollPermissionKeys';

vi.mock('../../../api/client', () => ({
  payrollApi: {
    getBatches: vi.fn(),
    getSourceMode: vi.fn(),
    submit: vi.fn(),
  },
}));

// fix(integration) — CE-13 UI closure: PayrollDashboard now reads the
// authorized legal entity via useEntityScope() (see EntityScopeContext.tsx)
// instead of assuming one. Mirrors the established mock convention in
// e.g. WipOpenRoReport.test.tsx, but as an overridable vi.fn() so individual
// tests can exercise the no-entities-configured / not-yet-selected states.
const mockUseEntityScope = vi.fn();
vi.mock('../../../context/EntityScopeContext', () => ({
  useEntityScope: () => mockUseEntityScope(),
}));

const ENTITY_SCOPE_WITH_ENTITY = {
  entityId: 'entity-1', entityLabel: 'CE13-A — CE13 Cert Legal Entity A', storeId: null, consolidated: false,
  entities: [{ id: 'entity-1', entityCode: 'CE13-A', legalName: 'CE13 Cert Legal Entity A' }],
  loading: false, noEntitiesConfigured: false, error: null,
  setEntity: vi.fn(), setStore: vi.fn(), setConsolidated: vi.fn(),
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/accounting/payroll/dashboard']}>
        <PayrollDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BATCH = {
  id: 'batch-1', batchNumber: 'PB-1001', payPeriodStart: '2024-01-01', payPeriodEnd: '2024-01-14',
  payDate: '2024-01-19', status: 'DRAFT', totalGrossPay: 10000, totalNetPay: 7500, employeeCount: 5,
};

describe('PayrollDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('userPermissions', JSON.stringify(Object.values(PAYROLL_PERMISSIONS)));
    mockUseEntityScope.mockReturnValue(ENTITY_SCOPE_WITH_ENTITY);
  });

  it('renders a populated batch table (happy render)', async () => {
    (payrollApi.getBatches as any).mockResolvedValue([BATCH]);
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'admin', updatedAt: null });
    renderPage();
    expect(await screen.findByTestId('payroll-batches-table')).toBeInTheDocument();
    expect(screen.getByText('PB-1001')).toBeInTheDocument();
  });

  it('shows the PAYROLL_SOURCE_NOT_CONFIGURED banner when source mode is unset', async () => {
    (payrollApi.getBatches as any).mockResolvedValue([BATCH]);
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'NOT_CONFIGURED', updatedBy: null, updatedAt: null });
    renderPage();
    expect(await screen.findByTestId('payroll-source-not-configured-banner')).toBeInTheDocument();
  });

  it('shows the empty state with no batches', async () => {
    (payrollApi.getBatches as any).mockResolvedValue([]);
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'admin', updatedAt: null });
    renderPage();
    expect(await screen.findByTestId('payroll-batches-empty')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 403 response', async () => {
    const err: any = new Error('Missing required permission: payroll.batch.view');
    err.status = 403;
    (payrollApi.getBatches as any).mockRejectedValue(err);
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'NOT_CONFIGURED', updatedBy: null, updatedAt: null });
    renderPage();
    expect(await screen.findByTestId('payroll-unauthorized')).toBeInTheDocument();
  });

  it('shows the real entity selector with the currently-scoped entity label, and threads its id into batch creation', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatches as any).mockResolvedValue([]);
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'admin', updatedAt: null });
    (payrollApi.submit as any).mockResolvedValue({ ...BATCH });
    renderPage();

    expect(await screen.findByTestId('payroll-current-entity-label')).toHaveTextContent('CE13-A — CE13 Cert Legal Entity A');
    await user.click(screen.getByTestId('payroll-new-batch-btn'));
    await user.type(screen.getByTestId('payroll-batch-number-input'), 'PB-2002');
    await user.click(screen.getByTestId('payroll-create-batch-submit'));
    await waitFor(() => expect(payrollApi.submit).toHaveBeenCalledWith(expect.objectContaining({ legalEntityId: 'entity-1' })));
  });

  it('shows the honest "no legal entities configured" state rather than a silent empty batch list', async () => {
    mockUseEntityScope.mockReturnValue({ ...ENTITY_SCOPE_WITH_ENTITY, entityId: null, entityLabel: null, entities: [], noEntitiesConfigured: true });
    (payrollApi.getBatches as any).mockResolvedValue([]);
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'NOT_CONFIGURED', updatedBy: null, updatedAt: null });
    renderPage();
    expect(await screen.findByTestId('payroll-no-entities')).toBeInTheDocument();
  });

  it('prompts entity selection rather than substituting tenantId when no entity is yet selected', async () => {
    mockUseEntityScope.mockReturnValue({ ...ENTITY_SCOPE_WITH_ENTITY, entityId: null, entityLabel: null });
    (payrollApi.getBatches as any).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByTestId('payroll-select-entity')).toBeInTheDocument();
    expect(payrollApi.getBatches).not.toHaveBeenCalled();
  });

  it('creates a batch successfully', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatches as any).mockResolvedValue([]);
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'admin', updatedAt: null });
    (payrollApi.submit as any).mockResolvedValue({ ...BATCH });
    renderPage();

    await screen.findByTestId('payroll-batches-empty');
    await user.click(screen.getByTestId('payroll-new-batch-btn'));
    await user.type(screen.getByTestId('payroll-batch-number-input'), 'PB-2002');
    await user.click(screen.getByTestId('payroll-create-batch-submit'));
    await waitFor(() => expect(payrollApi.submit).toHaveBeenCalled());
  });

  it('surfaces DUPLICATE_PAYROLL_RUN (409) inline rather than retrying silently', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatches as any).mockResolvedValue([]);
    (payrollApi.getSourceMode as any).mockResolvedValue({ payrollSourceMode: 'ATTESTED_MANUAL_ENTRY', updatedBy: 'admin', updatedAt: null });
    const err: any = new Error('DUPLICATE_PAYROLL_RUN — a batch already exists for this provider run.');
    (payrollApi.submit as any).mockRejectedValue(err);
    renderPage();

    await screen.findByTestId('payroll-batches-empty');
    await user.click(screen.getByTestId('payroll-new-batch-btn'));
    await user.type(screen.getByTestId('payroll-batch-number-input'), 'PB-2002');
    await user.click(screen.getByTestId('payroll-create-batch-submit'));
    await waitFor(() => expect(screen.getByTestId('payroll-create-batch-error')).toHaveTextContent(/DUPLICATE_PAYROLL_RUN/));
  });
});

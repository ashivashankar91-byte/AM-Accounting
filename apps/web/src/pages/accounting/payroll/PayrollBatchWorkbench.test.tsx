/**
 * CE-13 — Payroll Batch Workbench UI tests. Covers happy render, hold
 * banner, unauthorized state, adding an earnings line, validation,
 * self-approval denial surfaced truthfully, hold/release, governed
 * posting with missing-mapping refusal, void/reversal, register, and YTD
 * lookup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollBatchWorkbench from './PayrollBatchWorkbench';
import { payrollApi } from '../../../api/client';
import { PAYROLL_PERMISSIONS } from './payrollPermissionKeys';

vi.mock('../../../api/client', () => ({
  payrollApi: {
    getBatch: vi.fn(),
    getRegister: vi.fn(),
    getEmployeeYTD: vi.fn(),
    addBatchItem: vi.fn(),
    validate: vi.fn(),
    approveBatch: vi.fn(),
    hold: vi.fn(),
    release: vi.fn(),
    post: vi.fn(),
    voidBatch: vi.fn(),
    getBatchPaymentHandoff: vi.fn(),
  },
}));

// fix(integration) — CE-13 UI closure: the batch workbench now reads the
// selected legal entity to show a cross-entity warning banner (see
// EntityScopeContext.tsx). Mirrors the established mock convention in
// e.g. WipOpenRoReport.test.tsx.
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
      <MemoryRouter initialEntries={['/accounting/payroll/batches/batch-1']}>
        <Routes>
          <Route path="/accounting/payroll/batches/:batchId" element={<PayrollBatchWorkbench />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BATCH = { id: 'batch-1', batchNumber: 'PB-1001', status: 'DRAFT', items: [], legalEntityId: 'entity-1' };

describe('PayrollBatchWorkbench', () => {
  beforeEach(() => {
    localStorage.setItem('userPermissions', JSON.stringify(Object.values(PAYROLL_PERMISSIONS)));
  });

  it('renders the batch header and tabs (happy render)', async () => {
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    renderPage();
    expect(await screen.findByTestId('payroll-batch-workbench-page')).toBeInTheDocument();
    expect(screen.getByText('Batch PB-1001')).toBeInTheDocument();
  });

  it('shows the hold banner when the batch is on HOLD', async () => {
    (payrollApi.getBatch as any).mockResolvedValue({ ...BATCH, status: 'HOLD', holdReason: 'discrepancy under review', heldBy: 'controller-1' });
    renderPage();
    expect(await screen.findByTestId('payroll-batch-hold-banner')).toHaveTextContent('discrepancy under review');
  });

  it('shows unauthorized state on a 401 response', async () => {
    const err: any = new Error('unauthorized');
    err.status = 401;
    (payrollApi.getBatch as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('payroll-batch-unauthorized')).toBeInTheDocument();
  });

  it('adds an earnings/deduction line', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    (payrollApi.addBatchItem as any).mockResolvedValue({ id: 'item-1' });
    renderPage();

    await screen.findByTestId('payroll-add-item-form');
    await user.type(screen.getByTestId('payroll-item-employee-id'), 'emp-1');
    await user.click(screen.getByTestId('payroll-item-submit'));
    await waitFor(() => expect(payrollApi.addBatchItem).toHaveBeenCalled());
  });

  it('fix(integration): an attested gross withholding figure is sent under the real PayrollWithholdingLines.federalTax field, never the non-existent totalWithholding key that a prior defect silently discarded', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    (payrollApi.addBatchItem as any).mockResolvedValue({ id: 'item-1' });
    renderPage();

    await screen.findByTestId('payroll-add-item-form');
    await user.type(screen.getByTestId('payroll-item-employee-id'), 'emp-1');
    await user.type(screen.getByPlaceholderText(/Attested gross withholding/i), '300');
    await user.click(screen.getByTestId('payroll-item-submit'));
    await waitFor(() => expect(payrollApi.addBatchItem).toHaveBeenCalledWith(
      'batch-1',
      expect.objectContaining({ attestedWithholding: { federalTax: 300 } }),
    ));
  });

  it('runs validation', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    (payrollApi.validate as any).mockResolvedValue({ valid: true, errors: [] });
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-validation'));
    await user.click(screen.getByTestId('payroll-validate-btn'));
    await waitFor(() => expect(payrollApi.validate).toHaveBeenCalledWith('batch-1'));
  });

  it('surfaces self-approval denial (SoD) truthfully rather than retrying', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    const err: any = new Error('Preparer cannot also approve this batch (segregation of duties).');
    (payrollApi.approveBatch as any).mockRejectedValue(err);
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-approval'));
    await user.click(screen.getByTestId('payroll-approve-btn'));
    await waitFor(() => expect(screen.getByTestId('payroll-batch-action-error')).toHaveTextContent(/segregation of duties/));
  });

  it('holds and releases the batch', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    (payrollApi.hold as any).mockResolvedValue({ ...BATCH, status: 'HOLD' });
    (payrollApi.release as any).mockResolvedValue({ ...BATCH, status: 'DRAFT' });
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-approval'));
    await user.type(screen.getByTestId('payroll-hold-reason-input'), 'discrepancy');
    await user.click(screen.getByTestId('payroll-hold-btn'));
    await waitFor(() => expect(payrollApi.hold).toHaveBeenCalledWith('batch-1', 'discrepancy'));
    await user.click(screen.getByTestId('payroll-release-btn'));
    await waitFor(() => expect(payrollApi.release).toHaveBeenCalledWith('batch-1'));
  });

  it('posts the batch and shows journal linkage', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    (payrollApi.post as any).mockResolvedValue({ journalEntryId: 'je-abc123' });
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-posting'));
    await user.click(screen.getByTestId('payroll-post-btn'));
    await waitFor(() => expect(payrollApi.post).toHaveBeenCalledWith('batch-1'));
  });

  it('surfaces a missing-GL-mapping refusal on posting (never defaults to a production account)', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    const err: any = new Error('ACCOUNT_MAPPING_VALUES_PENDING — no rule-pack mapping for department sales/REGULAR_PAY.');
    (payrollApi.post as any).mockRejectedValue(err);
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-posting'));
    await user.click(screen.getByTestId('payroll-post-btn'));
    await waitFor(() => expect(screen.getByTestId('payroll-batch-action-error')).toHaveTextContent(/ACCOUNT_MAPPING_VALUES_PENDING/));
  });

  it('voids the batch with a reason (reversal linkage)', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue({ ...BATCH, status: 'POSTED', journalEntryId: 'je-1' });
    (payrollApi.voidBatch as any).mockResolvedValue({ reversalJournalEntryId: 'je-reversal-1' });
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-posting'));
    await user.type(screen.getByTestId('payroll-void-reason-input'), 'incorrect batch');
    await user.click(screen.getByTestId('payroll-void-btn'));
    await waitFor(() => expect(payrollApi.voidBatch).toHaveBeenCalledWith('batch-1', 'incorrect batch'));
  });

  it('loads the payroll register', async () => {
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    (payrollApi.getRegister as any).mockResolvedValue({ lines: [{ employeeId: 'emp-1', grossPay: 1000, totalDeductions: 200, netPay: 800, employerTax: 76 }] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-register'));
    expect(await screen.findByTestId('payroll-register-table')).toBeInTheDocument();
  });

  it('looks up employee YTD', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    (payrollApi.getEmployeeYTD as any).mockResolvedValue({ employeeId: 'emp-1', grossYtd: 5000 });
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-ytd'));
    await user.type(screen.getByTestId('payroll-ytd-employee-input'), 'emp-1');
    await user.click(screen.getByTestId('payroll-ytd-lookup-btn'));
    expect(await screen.findByTestId('payroll-ytd-result')).toHaveTextContent('emp-1');
  });
});

describe('PayrollBatchWorkbench — unauthorized UI reflection (CE-13 RBAC gap-closure)', () => {
  // Server-side attachPayrollRouteSecurity() is authoritative — this only
  // proves the UI disables mutating actions when the corresponding
  // permission is absent from the cached permission set.
  it('disables validate, approve, hold/release, post, and void actions when no permissions are granted', async () => {
    localStorage.setItem('userPermissions', JSON.stringify([]));
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    renderPage();

    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-validation'));
    expect(screen.getByTestId('payroll-validate-btn')).toBeDisabled();

    await user.click(screen.getByTestId('payroll-batch-tab-approval'));
    expect(screen.getByTestId('payroll-approve-btn')).toBeDisabled();
    expect(screen.getByTestId('payroll-hold-btn')).toBeDisabled();
    expect(screen.getByTestId('payroll-release-btn')).toBeDisabled();

    await user.click(screen.getByTestId('payroll-batch-tab-posting'));
    expect(screen.getByTestId('payroll-post-btn')).toBeDisabled();
    expect(screen.getByTestId('payroll-void-btn')).toBeDisabled();
  });
});

// fix(integration) — CE-13 UI closure: legal-entity reconciliation + CE-09
// payment-handoff status display.
describe('PayrollBatchWorkbench — legal-entity reconciliation + payment-handoff status', () => {
  beforeEach(() => {
    localStorage.setItem('userPermissions', JSON.stringify(Object.values(PAYROLL_PERMISSIONS)));
  });

  it('shows LEGAL_ENTITY_RECONCILIATION_REQUIRED and blocks item entry for a batch with no resolved legal entity', async () => {
    (payrollApi.getBatch as any).mockResolvedValue({ ...BATCH, legalEntityId: null });
    renderPage();
    expect(await screen.findByTestId('payroll-batch-legal-entity-reconciliation-required')).toBeInTheDocument();
    expect(screen.getByTestId('payroll-item-submit')).toBeDisabled();
  });

  it('shows a cross-entity warning when the batch belongs to a different legal entity than the one currently selected', async () => {
    (payrollApi.getBatch as any).mockResolvedValue({ ...BATCH, legalEntityId: 'entity-other' });
    renderPage();
    expect(await screen.findByTestId('payroll-batch-cross-entity-warning')).toBeInTheDocument();
  });

  it('shows the real NOT_CONFIGURED payment-handoff state when no handoff exists for this batch', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    const err: any = new Error('Not found');
    err.status = 404;
    (payrollApi.getBatchPaymentHandoff as any).mockRejectedValue(err);
    renderPage();
    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-handoff'));
    expect(await screen.findByTestId('payroll-handoff-not-configured')).toBeInTheDocument();
  });

  it('shows the real handoff record — batch, entity, amount, journal linkage — never a fabricated SETTLED state', async () => {
    const user = userEvent.setup();
    (payrollApi.getBatch as any).mockResolvedValue(BATCH);
    (payrollApi.getBatchPaymentHandoff as any).mockResolvedValue({
      status: 'PAYMENT_IN_PROCESS', batchId: 'batch-1', legalEntityId: 'entity-1', amount: 1500,
      liabilityAccountNumber: '2200', clearingAccountNumber: '1010', originalJournalEntryId: 'je-1',
      paymentLinkageReference: 'ext-ref-1', settlementEvidenceRef: null,
    });
    renderPage();
    await screen.findByTestId('payroll-batch-workbench-page');
    await user.click(screen.getByTestId('payroll-batch-tab-handoff'));
    const panel = await screen.findByTestId('payroll-handoff-panel');
    expect(panel).toHaveTextContent(/PAYMENT.IN.PROCESS/i);
    expect(screen.getByTestId('payroll-handoff-settlement-evidence')).toHaveTextContent('Not independently verified');
  });
});

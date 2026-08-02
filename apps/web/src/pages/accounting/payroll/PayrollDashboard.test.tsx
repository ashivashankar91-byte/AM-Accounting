/**
 * CE-13 — Payroll Dashboard UI tests. Covers happy render, statutory
 * source-not-configured banner, empty state, unauthorized state, batch
 * creation success, and duplicate-payroll (409) surfaced truthfully.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollDashboard from './PayrollDashboard';
import { payrollApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  payrollApi: {
    getBatches: vi.fn(),
    getSourceMode: vi.fn(),
    submit: vi.fn(),
  },
}));

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

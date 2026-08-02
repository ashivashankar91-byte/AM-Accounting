import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManualPayments from './ManualPayments';
import { manualPaymentApi, paymentLifecycleApi, bankAccountApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  manualPaymentApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    void: vi.fn(),
    retryScheduleRelief: vi.fn(),
  },
  paymentLifecycleApi: {
    markClearedTestOnly: vi.fn(),
    reissue: vi.fn(),
    requestStopPayment: vi.fn(),
    getStopPaymentRequests: vi.fn(),
    resolveStopPayment: vi.fn(),
    getEscheatQueue: vi.fn(),
    recordDueDiligence: vi.fn(),
    getDueDiligence: vi.fn(),
    postEscheatTransfer: vi.fn(),
  },
  bankAccountApi: {
    list: vi.fn(),
    create: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ManualPayments />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function apiError(status: number, body: any) {
  const err: any = new Error(body?.message ?? `API error ${status}`);
  err.status = status;
  err.body = body;
  return err;
}

const PAYMENT = {
  id: 'mp-1',
  invoiceId: 'inv-1',
  vendorId: 'v-1',
  status: 'POSTED',
  checkNumber: 1001,
  amount: '500.00',
  paymentDate: '2026-07-15',
  glEntryId: 'je-1',
  scheduleReliefStatus: 'RELIEVED',
  version: 1,
};

beforeEach(() => {
  vi.mocked(manualPaymentApi.list).mockReset();
  vi.mocked(manualPaymentApi.void).mockReset();
  vi.mocked(paymentLifecycleApi.requestStopPayment).mockReset();
  vi.mocked(paymentLifecycleApi.getStopPaymentRequests).mockReset();
  vi.mocked(paymentLifecycleApi.getDueDiligence).mockReset();
  vi.mocked(paymentLifecycleApi.getEscheatQueue).mockReset();
  vi.mocked(paymentLifecycleApi.postEscheatTransfer).mockReset();
  vi.mocked(bankAccountApi.list).mockReset();
});

describe('ManualPayments', () => {
  it('shows loading state', () => {
    vi.mocked(manualPaymentApi.list).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('shows empty state when no payments', async () => {
    vi.mocked(manualPaymentApi.list).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No manual payments/i)).toBeInTheDocument());
  });

  it('shows error state with retry', async () => {
    vi.mocked(manualPaymentApi.list).mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows unauthorized state for 403', async () => {
    vi.mocked(manualPaymentApi.list).mockRejectedValue(apiError(403, { message: 'Forbidden' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument());
  });

  it('renders payment rows when loaded', async () => {
    vi.mocked(manualPaymentApi.list).mockResolvedValue([PAYMENT]);
    renderPage();
    await waitFor(() => expect(screen.getByText('1001')).toBeInTheDocument());
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('POSTED')).toBeInTheDocument();
  });

  it('calls void API when void is confirmed', async () => {
    const user = userEvent.setup();
    vi.mocked(manualPaymentApi.list).mockResolvedValue([PAYMENT]);
    vi.mocked(paymentLifecycleApi.getStopPaymentRequests).mockResolvedValue([]);
    vi.mocked(paymentLifecycleApi.getDueDiligence).mockResolvedValue([]);
    vi.mocked(manualPaymentApi.void).mockResolvedValue({ ...PAYMENT, status: 'VOIDED' });
    renderPage();
    await waitFor(() => expect(screen.getByText('1001')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Manage/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Void$/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Void$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirm Void/i })).toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('Required'), 'Lost in mail');
    await user.click(screen.getByRole('button', { name: /Confirm Void/i }));
    await waitFor(() => expect(manualPaymentApi.void).toHaveBeenCalledWith('mp-1', { version: 1, reason: 'Lost in mail' }));
  });

  it('shows reconciled-void refusal banner on 409 VOID_REFUSED_PAYMENT_RECONCILED', async () => {
    const user = userEvent.setup();
    vi.mocked(manualPaymentApi.list).mockResolvedValue([PAYMENT]);
    vi.mocked(paymentLifecycleApi.getStopPaymentRequests).mockResolvedValue([]);
    vi.mocked(paymentLifecycleApi.getDueDiligence).mockResolvedValue([]);
    vi.mocked(manualPaymentApi.void).mockRejectedValue(
      apiError(409, { error: 'VOID_REFUSED_PAYMENT_RECONCILED', message: 'Payment has been reconciled.' })
    );
    renderPage();
    await waitFor(() => expect(screen.getByText('1001')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Manage/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Void$/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Void$/i }));
    await user.type(screen.getByPlaceholderText('Required'), 'test');
    await user.click(screen.getByRole('button', { name: /Confirm Void/i }));
    await waitFor(() => expect(screen.getByText(/Void Refused — Payment Reconciled/i)).toBeInTheDocument());
  });

  it('shows ESCHEAT_CONFIG_NOT_FOUND banner on 422', async () => {
    const user = userEvent.setup();
    vi.mocked(manualPaymentApi.list).mockResolvedValue([]);
    vi.mocked(paymentLifecycleApi.getEscheatQueue).mockResolvedValue([
      { id: 'mp-2', checkNumber: 2001, amount: '100.00', vendorId: 'v-2', status: 'PENDING', escheatStatus: 'PENDING' },
    ]);
    vi.mocked(paymentLifecycleApi.postEscheatTransfer).mockRejectedValue(
      apiError(422, { error: 'ESCHEAT_CONFIG_NOT_FOUND', message: 'No escheat config found for CA.' })
    );
    renderPage();
    // Wait for initial payments tab to load
    await waitFor(() => expect(screen.getByText(/No manual payments/i)).toBeInTheDocument());
    await user.click(screen.getByText('Escheat Queue'));
    await waitFor(() => expect(screen.getByText('1 payment in escheat queue')).toBeInTheDocument());
    const jurisdictionInput = screen.getByPlaceholderText(/Jurisdiction/i);
    await user.type(jurisdictionInput, 'CA');
    await user.click(screen.getByRole('button', { name: /Post Escheat Transfer/i }));
    await waitFor(() => expect(screen.getByText(/No Escheat Jurisdiction Configured/i)).toBeInTheDocument());
  });
});

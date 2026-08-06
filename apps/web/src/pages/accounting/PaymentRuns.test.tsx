import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PaymentRuns from './PaymentRuns';
import { paymentRunApi, bankAccountApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  paymentRunApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    execute: vi.fn(),
    generateRailArtifact: vi.fn(),
    getRailArtifacts: vi.fn(),
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
        <PaymentRuns />
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

const RUN = {
  id: 'run-1',
  bankAccountId: 'bank-1',
  dueDateThrough: '2026-07-31',
  totalAmount: 1250.00,
  status: 'PROPOSED',
  createdAt: '2026-07-01T00:00:00Z',
};

beforeEach(() => {
  vi.mocked(paymentRunApi.list).mockReset();
  vi.mocked(paymentRunApi.getById).mockReset();
  vi.mocked(paymentRunApi.approve).mockReset();
  vi.mocked(paymentRunApi.reject).mockReset();
  vi.mocked(paymentRunApi.execute).mockReset();
  vi.mocked(paymentRunApi.getRailArtifacts).mockReset();
  vi.mocked(bankAccountApi.list).mockReset();
});

describe('PaymentRuns', () => {
  it('shows loading state', () => {
    vi.mocked(paymentRunApi.list).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('shows empty state when no runs', async () => {
    vi.mocked(paymentRunApi.list).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No payment runs yet/i)).toBeInTheDocument());
  });

  it('shows error state with retry', async () => {
    vi.mocked(paymentRunApi.list).mockRejectedValue(new Error('Service error'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows unauthorized state for 403', async () => {
    vi.mocked(paymentRunApi.list).mockRejectedValue(apiError(403, { message: 'Forbidden' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument());
  });

  it('renders run rows when loaded', async () => {
    vi.mocked(paymentRunApi.list).mockResolvedValue([RUN]);
    renderPage();
    await waitFor(() => expect(screen.getByText('run-1')).toBeInTheDocument());
    expect(screen.getByText('PROPOSED')).toBeInTheDocument();
    expect(screen.getByText('$1250.00')).toBeInTheDocument();
  });

  it('approves a run', async () => {
    const user = userEvent.setup();
    vi.mocked(paymentRunApi.list).mockResolvedValue([RUN]);
    vi.mocked(paymentRunApi.getById).mockResolvedValue(RUN);
    vi.mocked(paymentRunApi.getRailArtifacts).mockResolvedValue([]);
    vi.mocked(paymentRunApi.approve).mockResolvedValue({ ...RUN, status: 'APPROVED' });
    renderPage();
    await waitFor(() => expect(screen.getByText('run-1')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Open/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => expect(paymentRunApi.approve).toHaveBeenCalledWith('run-1'));
  });

  it('shows execute confirmation dialog and executes', async () => {
    const user = userEvent.setup();
    const approvedRun = { ...RUN, status: 'APPROVED' };
    vi.mocked(paymentRunApi.list).mockResolvedValue([approvedRun]);
    vi.mocked(paymentRunApi.getById).mockResolvedValue(approvedRun);
    vi.mocked(paymentRunApi.getRailArtifacts).mockResolvedValue([]);
    vi.mocked(paymentRunApi.execute).mockResolvedValue({ ...approvedRun, status: 'EXECUTED' });
    renderPage();
    await waitFor(() => expect(screen.getByText('run-1')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Open/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Execute Run/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Execute Run/i }));
    await waitFor(() => expect(screen.getByText(/irreversible/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Yes, Execute Now/i }));
    await waitFor(() => expect(paymentRunApi.execute).toHaveBeenCalledWith('run-1'));
  });
});

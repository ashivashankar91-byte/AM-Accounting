/**
 * AMACC — TradePayoffPayments smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TradePayoffPayments from './TradePayoffPayments';
import { tradePayoffApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  tradePayoffApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TradePayoffPayments />
    </QueryClientProvider>,
  );
}

const PAYOFF = {
  id: 'tp-1',
  dealReference: 'DEAL-20240001',
  payeeName: 'First National Bank',
  payeeRemitAddress: '123 Bank St, Chicago IL',
  payeeReference: 'LOAN-99',
  amount: '12500.00',
  goodThroughDate: '2026-08-31',
  status: 'PENDING',
};

describe('TradePayoffPayments list', () => {
  it('shows loading state initially', () => {
    (tradePayoffApi.list as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading Trade Payoff Payments/i)).toBeInTheDocument();
  });

  it('shows empty state when no payoffs exist', async () => {
    (tradePayoffApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No trade payoff payments yet/i)).toBeInTheDocument());
  });

  it('shows error state with retry when list fails', async () => {
    const err = new Error('apar-service unreachable');
    (tradePayoffApi.list as any).mockRejectedValue(err);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('renders payoff rows when data is loaded', async () => {
    (tradePayoffApi.list as any).mockResolvedValue([PAYOFF]);
    renderPage();
    await waitFor(() => expect(screen.getByText('DEAL-20240001')).toBeInTheDocument());
    expect(screen.getByText('First National Bank')).toBeInTheDocument();
    expect(screen.getByText('LOAN-99')).toBeInTheDocument();
  });

  it('shows unauthorized message for 403 errors', async () => {
    const err: any = new Error('Forbidden');
    err.status = 403;
    (tradePayoffApi.list as any).mockRejectedValue(err);
    renderPage();
    await waitFor(() => expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument());
  });
});

describe('TradePayoffPayments create', () => {
  it('creates a new payoff record', async () => {
    const user = userEvent.setup();
    (tradePayoffApi.list as any).mockResolvedValue([]);
    (tradePayoffApi.create as any).mockResolvedValue(PAYOFF);
    (tradePayoffApi.getById as any).mockResolvedValue(PAYOFF);
    renderPage();

    await waitFor(() => expect(screen.getByText(/No trade payoff payments yet/i)).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: /New Payoff/i })[0]);

    await user.type(screen.getByPlaceholderText('DEAL-20240001'), 'DEAL-20240001');
    await user.type(screen.getByPlaceholderText('First National Bank'), 'First National Bank');
    await user.type(screen.getByPlaceholderText('123 Bank St, Chicago IL 60601'), '123 Bank St');

    const amountInput = screen.getByPlaceholderText('0.00');
    await user.type(amountInput, '12500');

    const dateInput = screen.getByLabelText(/Good Through Date/i);
    await user.type(dateInput, '2026-08-31');

    await user.click(screen.getByRole('button', { name: /Save Payoff/i }));
    await waitFor(() => expect(tradePayoffApi.create).toHaveBeenCalled());
  });
});

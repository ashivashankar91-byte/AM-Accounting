/**
 * S053 — Deposits UI smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Deposits from './Deposits';
import { depositApi, posReceiptApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  depositApi: {
    list: vi.fn(),
    getById: vi.fn(),
    getSlip: vi.fn(),
    post: vi.fn(),
    void: vi.fn(),
    getBankFeedStatus: vi.fn(),
    getBankFeedLines: vi.fn(),
    addManualFeedLine: vi.fn(),
    syncBankFeed: vi.fn(),
    matchFeedLine: vi.fn(),
    create: vi.fn(),
  },
  posReceiptApi: {
    searchReceipts: vi.fn(),
  },
}));

function renderPage(initialPath = '/deposits') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/deposits" element={<Deposits />} />
          <Route path="/deposits/:id" element={<Deposits />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DEPOSIT = { id: 'dep-1', depositNumber: 'DEP-001', businessDate: '2026-07-01', bankAccountCode: 'MAIN', totalAmount: '1500.00', status: 'PENDING' };

describe('Deposits list', () => {
  it('shows loading state', () => {
    (depositApi.list as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading Deposits/i)).toBeInTheDocument();
  });

  it('shows empty state when no deposits', async () => {
    (depositApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No deposits yet/i)).toBeInTheDocument());
  });

  it('shows error state with retry when list fails', async () => {
    (depositApi.list as any).mockRejectedValue(new Error('cash-service unreachable'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('renders deposit rows when loaded', async () => {
    (depositApi.list as any).mockResolvedValue([DEPOSIT]);
    renderPage();
    await waitFor(() => expect(screen.getByText('DEP-001')).toBeInTheDocument());
    expect(screen.getByText('2026-07-01')).toBeInTheDocument();
    expect(screen.getByText('MAIN')).toBeInTheDocument();
  });
});

describe('Deposits detail', () => {
  it('renders deposit detail with slip', async () => {
    (depositApi.getById as any).mockResolvedValue(DEPOSIT);
    (depositApi.getSlip as any).mockResolvedValue({ businessDate: '2026-07-01', bankAccountCode: 'MAIN', totalAmount: '1500.00', lines: [] });
    renderPage('/deposits/dep-1');
    await waitFor(() => expect(screen.getByText(/DEP-001/i)).toBeInTheDocument());
  });

  it('shows unauthorized message for 401 errors', async () => {
    const err: any = new Error('Unauthorized');
    err.status = 401;
    (depositApi.getById as any).mockRejectedValue(err);
    renderPage('/deposits/dep-1');
    await waitFor(() => expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument());
  });

  it('posts a deposit', async () => {
    (depositApi.getById as any).mockResolvedValue(DEPOSIT);
    (depositApi.getSlip as any).mockResolvedValue({ businessDate: '2026-07-01', bankAccountCode: 'MAIN', totalAmount: '1500.00', lines: [] });
    (depositApi.post as any).mockResolvedValue({ ...DEPOSIT, status: 'POSTED' });
    const user = userEvent.setup();
    renderPage('/deposits/dep-1');
    await waitFor(() => screen.getByRole('button', { name: /^Post$/i }));
    await user.click(screen.getByRole('button', { name: /^Post$/i }));
    await waitFor(() => expect(depositApi.post).toHaveBeenCalledWith('dep-1'));
  });
});

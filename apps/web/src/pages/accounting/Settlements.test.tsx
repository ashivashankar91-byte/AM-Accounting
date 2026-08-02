/**
 * S055 — Settlements UI smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Settlements from './Settlements';
import { settlementApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  settlementApi: {
    getStatus: vi.fn(),
    importBatch: vi.fn(),
    listBatches: vi.fn(),
    getBatch: vi.fn(),
    matchBatch: vi.fn(),
    postBatch: vi.fn(),
    getWorklist: vi.fn(),
    addWorklistItem: vi.fn(),
    resolveWorklistItem: vi.fn(),
    intakeChargeback: vi.fn(),
    dispositionChargeback: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Settlements />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BATCH = { id: 'batch-1', batchReference: 'BATCH-001', processorName: 'Stripe', settlementDate: '2026-07-01', grossAmount: '5000.00', status: 'IMPORTED' };

describe('Settlements', () => {
  it('shows loading state', () => {
    (settlementApi.getStatus as any).mockReturnValue(new Promise(() => {}));
    (settlementApi.listBatches as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading Batches/i)).toBeInTheDocument();
  });

  it('shows empty state when no batches', async () => {
    (settlementApi.getStatus as any).mockResolvedValue({ status: 'OK', lastUpdatedAt: null, pendingBatches: 0 });
    (settlementApi.listBatches as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No settlement batches/i)).toBeInTheDocument());
  });

  it('shows error state when list fails', async () => {
    (settlementApi.getStatus as any).mockResolvedValue({ status: 'OK' });
    (settlementApi.listBatches as any).mockRejectedValue(new Error('cash-service unreachable'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
  });

  it('renders batch rows when loaded', async () => {
    (settlementApi.getStatus as any).mockResolvedValue({ status: 'OK', lastUpdatedAt: '2026-07-01', pendingBatches: 1 });
    (settlementApi.listBatches as any).mockResolvedValue([BATCH]);
    renderPage();
    await waitFor(() => expect(screen.getByText('BATCH-001')).toBeInTheDocument());
    expect(screen.getByText('Stripe')).toBeInTheDocument();
  });

  it('worklist tab shows empty state', async () => {
    (settlementApi.getStatus as any).mockResolvedValue({ status: 'OK' });
    (settlementApi.listBatches as any).mockResolvedValue([]);
    (settlementApi.getWorklist as any).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /Worklist/i }));
    await user.click(screen.getByRole('button', { name: /Worklist/i }));
    await waitFor(() => expect(screen.getByText(/Worklist empty/i)).toBeInTheDocument());
  });
});

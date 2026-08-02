/**
 * S056 — Sweeps UI smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Sweeps from './Sweeps';
import { sweepApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  sweepApi: {
    configurePair: vi.fn(),
    listPairs: vi.fn(),
    record: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    post: vi.fn(),
    void: vi.fn(),
    createFpOffsetAllocation: vi.fn(),
    listFpOffsetAllocations: vi.fn(),
    getFpOffsetAllocation: vi.fn(),
    postFpOffsetAllocation: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Sweeps />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PAIR = { id: 'pair-1', storeAccountCode: 'STORE-001', operatingAccountCode: 'OPS-001', entityId: 'ent-1' };
const SWEEP = { id: 'sw-1', sweepDate: '2026-07-01', direction: 'STORE_TO_OPERATING', amount: '10000.00', status: 'PENDING', confirmationState: 'MANUAL_RECORDED' };

describe('Sweeps', () => {
  it('shows loading state', () => {
    (sweepApi.listPairs as any).mockReturnValue(new Promise(() => {}));
    (sweepApi.list as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading Sweeps/i)).toBeInTheDocument();
  });

  it('shows empty state when no sweeps', async () => {
    (sweepApi.listPairs as any).mockResolvedValue([PAIR]);
    (sweepApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No sweeps recorded/i)).toBeInTheDocument());
  });

  it('shows error state when list fails', async () => {
    (sweepApi.listPairs as any).mockResolvedValue([]);
    (sweepApi.list as any).mockRejectedValue(new Error('cash-service unreachable'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
  });

  it('renders sweep rows when loaded', async () => {
    (sweepApi.listPairs as any).mockResolvedValue([PAIR]);
    (sweepApi.list as any).mockResolvedValue([SWEEP]);
    renderPage();
    await waitFor(() => expect(screen.getByText('STORE_TO_OPERATING')).toBeInTheDocument());
    expect(screen.getByText('2026-07-01')).toBeInTheDocument();
  });

  it('FP Allocations tab shows empty state', async () => {
    (sweepApi.listPairs as any).mockResolvedValue([]);
    (sweepApi.list as any).mockResolvedValue([]);
    (sweepApi.listFpOffsetAllocations as any).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /FP Offset Allocations/i }));
    await user.click(screen.getByRole('button', { name: /FP Offset Allocations/i }));
    await waitFor(() => expect(screen.getByText(/No FP offset allocations/i)).toBeInTheDocument());
  });
});

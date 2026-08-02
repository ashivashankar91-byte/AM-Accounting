/**
 * CashPosition.test.tsx — S057 smoke tests.
 * All monetary values must come from API — no client-side arithmetic.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CashPosition from './CashPosition';
import { cashPositionApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  cashPositionApi: {
    get: vi.fn(),
    exportPosition: vi.fn(),
    listExports: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CashPosition />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The query is `enabled: !!entityId && !!businessDate` (a real CE-09 cert bug
// fix — the API 400s without both params). businessDate defaults to today,
// but entityId starts empty and must be entered before cashPositionApi.get()
// fires, so every test that expects the query to run must fill it first.
async function renderWithEntity() {
  const user = userEvent.setup();
  const result = renderPage();
  await user.type(screen.getByTestId('cashpos-entity-id'), 'entity-kunes-delavan');
  return result;
}

const POSITION = {
  drawers: 15000.00,
  deposits: 32500.50,
  settlements: 8200.00,
  sweeps: 5000.00,
  totalCash: 60700.50,
};

describe('CashPosition', () => {
  it('renders position tiles from API response', async () => {
    (cashPositionApi.get as any).mockResolvedValue(POSITION);
    (cashPositionApi.listExports as any).mockResolvedValue([]);
    await renderWithEntity();
    await waitFor(() => expect(screen.getAllByText(/Cash Position/i).length).toBeGreaterThan(0));
    // Tile labels derived from object keys — use getAllByText since nav also contains these words
    await waitFor(() => {
      const els = screen.getAllByText(/drawers/i);
      expect(els.length).toBeGreaterThan(0);
    });
  });

  it('shows loading state', async () => {
    (cashPositionApi.get as any).mockReturnValue(new Promise(() => {}));
    (cashPositionApi.listExports as any).mockResolvedValue([]);
    await renderWithEntity();
    await waitFor(() => expect(screen.getByText(/Loading/i)).toBeInTheDocument());
  });

  it('shows error state with retry button on failure', async () => {
    (cashPositionApi.get as any).mockRejectedValue(new Error('cash-service unreachable'));
    (cashPositionApi.listExports as any).mockResolvedValue([]);
    await renderWithEntity();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows empty state when API returns empty object', async () => {
    (cashPositionApi.get as any).mockResolvedValue({});
    (cashPositionApi.listExports as any).mockResolvedValue([]);
    await renderWithEntity();
    await waitFor(() => expect(screen.getByText(/No position data/i)).toBeInTheDocument());
  });

  it('shows Unauthorized banner on 401', async () => {
    const err: any = new Error('Unauthorized');
    err.status = 401;
    (cashPositionApi.get as any).mockRejectedValue(err);
    (cashPositionApi.listExports as any).mockResolvedValue([]);
    await renderWithEntity();
    await waitFor(() => expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument());
  });

  it('calls exportPosition when Export button is clicked', async () => {
    (cashPositionApi.get as any).mockResolvedValue(POSITION);
    (cashPositionApi.listExports as any).mockResolvedValue([]);
    (cashPositionApi.exportPosition as any).mockResolvedValue({ id: 'exp-1', status: 'COMPLETED' });
    const user = userEvent.setup();
    await renderWithEntity();

    await waitFor(() => expect(screen.getByRole('button', { name: /Export/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Export/i }));

    await waitFor(() => expect(cashPositionApi.exportPosition).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Position exported successfully/i)).toBeInTheDocument());
  });

  it('shows past exports table', async () => {
    (cashPositionApi.get as any).mockResolvedValue(POSITION);
    (cashPositionApi.listExports as any).mockResolvedValue([
      { id: 'exp-0001', createdAt: '2026-07-31T10:00:00Z', format: 'JSON', status: 'COMPLETED' },
    ]);
    await renderWithEntity();

    await waitFor(() => expect(screen.getByText('COMPLETED')).toBeInTheDocument());
  });
});

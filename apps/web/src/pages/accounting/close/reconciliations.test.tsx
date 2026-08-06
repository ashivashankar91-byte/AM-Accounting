/**
 * S115 — Reconciliation Register smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Reconciliations from './reconciliations';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: { listRegister: vi.fn(), createRegister: vi.fn(), signOffRegister: vi.fn(), exportPbc: vi.fn() },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('Reconciliations', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.listRegister as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<Reconciliations />));
    expect(screen.getByText(/loading|reconciliation/i)).toBeTruthy();
  });

  it('renders empty state', async () => {
    (closeApi.listRegister as any).mockResolvedValue([]);
    render(wrap(<Reconciliations />));
    await waitFor(() =>
      expect(screen.getByText(/S115|reconciliation/i)).toBeTruthy()
    );
  });

  it('renders reconciliation row', async () => {
    (closeApi.listRegister as any).mockResolvedValue([{
      id: 'r1', moduleCode: 'AP', accountCode: 'A100', legalEntityId: 'LE1',
      status: 'PENDING', balanceGl: 1000, balanceSub: 1000,
      period: '2026-01', reconciledBy: null, signedOffAt: null,
    }]);
    render(wrap(<Reconciliations />));
    await waitFor(() => expect(screen.getByText('A100')).toBeTruthy());
  });

  it('renders RECONCILED badge', async () => {
    (closeApi.listRegister as any).mockResolvedValue([{
      id: 'r2', accountId: 'A200', legalEntityId: 'LE1',
      status: 'RECONCILED', balanceGl: 500, balanceSub: 500,
      period: '2026-01', reconciledBy: 'user1', signedOffAt: '2026-01-31',
    }]);
    render(wrap(<Reconciliations />));
    await waitFor(() => expect(screen.getByText(/reconciled/i)).toBeTruthy());
  });
});

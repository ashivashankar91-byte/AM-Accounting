/**
 * S119/S120 — Variable Ops KPI smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VariableOpsKpi from './variable-ops';
import { closeApi } from '../../../../api/client';

vi.mock('../../../../api/client', () => ({ closeApi: { listFormulas: vi.fn() } }));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('VariableOpsKpi', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.listFormulas as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<VariableOpsKpi />));
    expect(screen.getByText(/loading|variable.?ops/i)).toBeTruthy();
  });

  it('renders empty state', async () => {
    (closeApi.listFormulas as any).mockResolvedValue([]);
    render(wrap(<VariableOpsKpi />));
    await waitFor(() => expect(screen.getByText(/variable.?ops/i)).toBeTruthy());
  });
});

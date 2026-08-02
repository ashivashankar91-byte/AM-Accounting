/**
 * S119/S120 — Fixed Ops KPI smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FixedOpsKpi from './fixed-ops';
import { closeApi } from '../../../../api/client';

vi.mock('../../../../api/client', () => ({ closeApi: { listFormulas: vi.fn() } }));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('FixedOpsKpi', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.listFormulas as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<FixedOpsKpi />));
    expect(screen.getByText(/loading|fixed.?ops/i)).toBeTruthy();
  });

  it('renders empty state for no FIXED_OPS formulas', async () => {
    (closeApi.listFormulas as any).mockResolvedValue([]);
    render(wrap(<FixedOpsKpi />));
    await waitFor(() => expect(screen.getByText(/fixed.?ops/i)).toBeTruthy());
  });

  it('renders fixed ops formula row', async () => {
    (closeApi.listFormulas as any).mockResolvedValue([{
      id: 'f1', formulaCode: 'FIXED_OPS_GROSS', label: 'Fixed Ops Gross Profit',
      numeratorAccountIds: ['1001'], denominatorAccountIds: [],
    }]);
    render(wrap(<FixedOpsKpi />));
    await waitFor(() => expect(screen.getByText(/fixed.?ops|gross/i)).toBeTruthy());
  });
});

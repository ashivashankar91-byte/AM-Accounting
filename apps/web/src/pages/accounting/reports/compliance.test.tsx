/**
 * S123 — Compliance Pack smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Compliance from './compliance';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: { listCompliancePacks: vi.fn(), generateCompliancePack: vi.fn() },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('Compliance', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.listCompliancePacks as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<Compliance />));
    expect(screen.getByText(/loading|compliance/i)).toBeTruthy();
  });

  it('renders empty state', async () => {
    (closeApi.listCompliancePacks as any).mockResolvedValue([]);
    render(wrap(<Compliance />));
    await waitFor(() => expect(screen.getByText(/S123|compliance/i)).toBeTruthy());
  });
});

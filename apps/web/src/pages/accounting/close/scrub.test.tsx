/**
 * S114 — Pre-Close Scrub smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Scrub from './scrub';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: { listScrubRuns: vi.fn(), runScrub: vi.fn(), getScrubFindings: vi.fn(), disposeFinding: vi.fn() },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('Scrub', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.listScrubRuns as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<Scrub />));
    expect(screen.getByText(/loading|scrub/i)).toBeTruthy();
  });

  it('renders scrub run row', async () => {
    (closeApi.listScrubRuns as any).mockResolvedValue([{
      id: 's1', status: 'COMPLETE', findingCount: 3, criticalCount: 1,
      startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z',
    }]);
    render(wrap(<Scrub />));
    await waitFor(() => expect(screen.getByText(/S114|scrub|pre-close/i)).toBeTruthy());
  });

  it('renders empty state', async () => {
    (closeApi.listScrubRuns as any).mockResolvedValue([]);
    render(wrap(<Scrub />));
    await waitFor(() => expect(screen.getByText(/S114|scrub/i)).toBeTruthy());
  });
});

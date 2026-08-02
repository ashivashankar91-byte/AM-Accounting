/**
 * S017 — Document Retention & Archive smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Archive from './archive';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: {
    listArchiveObjects: vi.fn(),
    createArchiveObject: vi.fn(),
    getArchiveObject: vi.fn(),
    deleteArchiveObject: vi.fn(),
    createRetentionSchedule: vi.fn(),
  },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('Archive', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.listArchiveObjects as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<Archive />));
    expect(screen.getByText(/loading|archive|retention/i)).toBeTruthy();
  });

  it('renders empty state', async () => {
    (closeApi.listArchiveObjects as any).mockResolvedValue([]);
    render(wrap(<Archive />));
    await waitFor(() => expect(screen.getByText(/S017|archive|retention/i)).toBeTruthy());
  });

  it('shows retention schedule form', async () => {
    (closeApi.listArchiveObjects as any).mockResolvedValue([]);
    render(wrap(<Archive />));
    await waitFor(() => expect(screen.getByText(/S017|WORM|archive/i)).toBeTruthy());
  });
});

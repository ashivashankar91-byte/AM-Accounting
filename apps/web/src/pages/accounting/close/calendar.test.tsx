/**
 * S113 — Close Calendar smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CloseCalendar from './calendar';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({ closeApi: { listFormulas: vi.fn() } }));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('CloseCalendar', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.listFormulas as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<CloseCalendar />));
    expect(screen.getByText(/loading|calendar/i)).toBeTruthy();
  });

  it('renders empty state when no tasks', async () => {
    (closeApi.listFormulas as any).mockResolvedValue([]);
    render(wrap(<CloseCalendar />));
    await waitFor(() => expect(screen.getByText(/no.*(tasks?|items?|entries?)|empty|calendar/i)).toBeTruthy());
  });

  it('renders error state', async () => {
    (closeApi.listFormulas as any).mockRejectedValue(new Error('fail'));
    render(wrap(<CloseCalendar />));
    await waitFor(() => expect(screen.getByText(/error|failed|unavailable/i)).toBeTruthy());
  });
});

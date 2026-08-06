/**
 * S116 — Year-End Close Ceremony smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import YearEnd from './year-end';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: { previewYearEnd: vi.fn(), approveYearEnd: vi.fn(), postYearEnd: vi.fn(), listArchiveObjects: vi.fn() },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('YearEnd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (closeApi.listArchiveObjects as any).mockResolvedValue([]);
  });

  it('renders the page title', () => {
    render(wrap(<YearEnd />));
    expect(screen.getByText(/S116|year.?end|ceremony/i)).toBeTruthy();
  });

  it('shows Preview Year-End button', async () => {
    render(wrap(<YearEnd />));
    expect(await screen.findByRole('button', { name: /preview year-end/i })).toBeTruthy();
  });

  it('calls previewYearEnd on click', async () => {
    (closeApi.previewYearEnd as any).mockResolvedValue({ previewId: 'p1', lines: [] });
    render(wrap(<YearEnd />));
    const btn = await screen.findByRole('button', { name: /preview year-end/i });
    await userEvent.click(btn);
    await waitFor(() => expect(closeApi.previewYearEnd).toHaveBeenCalled());
  });
});

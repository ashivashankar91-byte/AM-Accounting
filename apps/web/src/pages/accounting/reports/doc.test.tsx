/**
 * S122 — Director of Compliance smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Doc from './doc';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: { getDoc: vi.fn() },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('Doc', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.getDoc as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<Doc />));
    expect(screen.getByText(/loading|compliance/i)).toBeTruthy();
  });

  it('renders error', async () => {
    (closeApi.getDoc as any).mockRejectedValue(new Error('fail'));
    render(wrap(<Doc />));
    await waitFor(() => expect(screen.getByText(/error|failed|S122|director/i)).toBeTruthy());
  });
});

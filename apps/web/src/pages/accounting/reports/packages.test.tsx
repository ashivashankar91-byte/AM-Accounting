/**
 * S016 — Signed Statement Snapshots smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Packages from './packages';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: { captureSnapshot: vi.fn(), primarySign: vi.fn(), secondarySign: vi.fn(), verifySnapshot: vi.fn() },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('Packages', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders S016 snapshot page', () => {
    render(wrap(<Packages />));
    expect(screen.getByText(/S016|snapshot|statement/i)).toBeTruthy();
  });
});

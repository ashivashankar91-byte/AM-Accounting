/**
 * S113/S114/S119/S120/S121/S122 — Close Command Center smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CloseCommandCenter from './index';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: {
    getState: vi.fn(),
    getReadiness: vi.fn(),
    transition: vi.fn(),
  },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('CloseCommandCenter', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state initially', () => {
    (closeApi.getState as any).mockReturnValue(new Promise(() => {}));
    (closeApi.getReadiness as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<CloseCommandCenter />));
    expect(screen.getByText(/loading|close command center/i)).toBeTruthy();
  });

  it('renders NOT_READY state badge', async () => {
    (closeApi.getState as any).mockResolvedValue({ state: 'NOT_READY', legalEntityId: 'LE1' });
    (closeApi.getReadiness as any).mockResolvedValue({ modules: [] });
    render(wrap(<CloseCommandCenter />));
    await waitFor(() => expect(screen.getByText(/not.?ready/i)).toBeTruthy());
  });

  it('renders FINAL_CLOSED state badge', async () => {
    (closeApi.getState as any).mockResolvedValue({ state: 'FINAL_CLOSED', legalEntityId: 'LE1' });
    (closeApi.getReadiness as any).mockResolvedValue({ modules: [] });
    render(wrap(<CloseCommandCenter />));
    await waitFor(() => expect(screen.getByText(/final.?closed/i)).toBeTruthy());
  });

  it('renders ELIMINATIONS_PENDING readiness signal', async () => {
    (closeApi.getState as any).mockResolvedValue({ state: 'NOT_READY', legalEntityId: 'LE1' });
    (closeApi.getReadiness as any).mockResolvedValue({
      signals: [{ moduleCode: 'CONSOLIDATION', signal: 'ELIMINATIONS_PENDING' }],
    });
    render(wrap(<CloseCommandCenter />));
    await waitFor(() => expect(screen.getByText(/eliminations pending/i)).toBeTruthy());
  });

  it('renders PENDING_UPSTREAM_TECHNICAL_RECONCILIATION signal', async () => {
    (closeApi.getState as any).mockResolvedValue({ state: 'NOT_READY', legalEntityId: 'LE1' });
    (closeApi.getReadiness as any).mockResolvedValue({
      signals: [{ moduleCode: 'AP', signal: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION' }],
    });
    render(wrap(<CloseCommandCenter />));
    await waitFor(() => expect(screen.getByText(/pending/i)).toBeTruthy());
  });

  it('renders error state', async () => {
    (closeApi.getState as any).mockRejectedValue(new Error('API down'));
    (closeApi.getReadiness as any).mockRejectedValue(new Error('API down'));
    render(wrap(<CloseCommandCenter />));
    await waitFor(() =>
      expect(screen.getByText(/error|failed|unavailable/i)).toBeTruthy()
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PostingRecoveryQueue from './PostingRecoveryQueue';
import { postingRecoveryApi } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  postingRecoveryApi: {
    listQueue: vi.fn(),
    getSummary: vi.fn(),
  },
}));

function renderQueue() {
  return render(
    <MemoryRouter>
      <PostingRecoveryQueue />
    </MemoryRouter>,
  );
}

const SAMPLE_ITEM = {
  id: '11111111-1111-1111-1111-111111111111',
  sourceEventType: 'DEAL_POSTED',
  sourceSystem: 'deal-service',
  sourceTransactionId: 'DEAL-1',
  status: 'QUARANTINED',
  latestFailureCategory: 'RULE_NOT_FOUND',
  latestFailureCode: 'RULE_PACK_NOT_FOUND',
  latestFailureMessage: 'No rule pack matched',
  firstFailureAt: '2026-07-01T00:00:00.000Z',
  latestFailureAt: '2026-07-01T00:00:00.000Z',
  attemptCount: 0,
  assignedOwner: null,
  escalationState: null,
};

describe('PostingRecoveryQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ isAuthenticated: true });
    (postingRecoveryApi.getSummary as any).mockResolvedValue({ byStatus: {}, byFailureCategory: {} });
  });

  it('shows an unauthenticated prompt when not signed in', () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: false });
    renderQueue();
    expect(screen.getByText(/Sign in to view Posting Recovery/i)).toBeInTheDocument();
  });

  it('shows a loading state while the queue request is in flight', async () => {
    (postingRecoveryApi.listQueue as any).mockReturnValue(new Promise(() => {}));
    renderQueue();
    expect(await screen.findByTestId('prq-loading')).toBeInTheDocument();
  });

  it('shows an empty state when the queue has no matching cases', async () => {
    (postingRecoveryApi.listQueue as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
    renderQueue();
    expect(await screen.findByTestId('prq-empty')).toBeInTheDocument();
  });

  it('renders a populated queue table', async () => {
    (postingRecoveryApi.listQueue as any).mockResolvedValue({ items: [SAMPLE_ITEM], total: 1, page: 1, pageSize: 25 });
    renderQueue();
    expect(await screen.findByTestId('prq-table')).toBeInTheDocument();
    expect(screen.getByText('DEAL_POSTED')).toBeInTheDocument();
    expect(screen.getByText('DEAL-1')).toBeInTheDocument();
  });

  it('shows an API error state with a retry action', async () => {
    const err: any = new Error('Service unavailable');
    (postingRecoveryApi.listQueue as any).mockRejectedValueOnce(err).mockResolvedValueOnce({ items: [SAMPLE_ITEM], total: 1, page: 1, pageSize: 25 });
    renderQueue();
    expect(await screen.findByTestId('prq-error')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByTestId('prq-table')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('Missing required permission: posting-recovery.queue.read');
    err.status = 403;
    (postingRecoveryApi.listQueue as any).mockRejectedValue(err);
    renderQueue();
    expect(await screen.findByTestId('prq-unauthorized')).toBeInTheDocument();
    expect(screen.getByText(/posting-recovery.queue.read/)).toBeInTheDocument();
  });

  it('re-queries when the status filter changes', async () => {
    (postingRecoveryApi.listQueue as any).mockResolvedValue({ items: [SAMPLE_ITEM], total: 1, page: 1, pageSize: 25 });
    renderQueue();
    await screen.findByTestId('prq-table');
    fireEvent.change(screen.getByTestId('prq-filter-status'), { target: { value: 'UNDER_REVIEW' } });
    await waitFor(() => {
      const lastCall = (postingRecoveryApi.listQueue as any).mock.calls.at(-1)[0];
      expect(lastCall).toContain('status=UNDER_REVIEW');
    });
  });

  it('re-queries when the search box changes', async () => {
    (postingRecoveryApi.listQueue as any).mockResolvedValue({ items: [SAMPLE_ITEM], total: 1, page: 1, pageSize: 25 });
    renderQueue();
    await screen.findByTestId('prq-table');
    fireEvent.change(screen.getByTestId('prq-filter-search'), { target: { value: 'DEAL-1' } });
    await waitFor(() => {
      const lastCall = (postingRecoveryApi.listQueue as any).mock.calls.at(-1)[0];
      expect(lastCall).toContain('search=DEAL-1');
    });
  });

  it('paginates using Next/Previous', async () => {
    (postingRecoveryApi.listQueue as any).mockResolvedValue({ items: [SAMPLE_ITEM], total: 60, page: 1, pageSize: 25 });
    renderQueue();
    await screen.findByTestId('prq-table');
    fireEvent.click(screen.getByTestId('prq-page-next'));
    await waitFor(() => {
      const lastCall = (postingRecoveryApi.listQueue as any).mock.calls.at(-1)[0];
      expect(lastCall).toContain('page=2');
    });
  });
});

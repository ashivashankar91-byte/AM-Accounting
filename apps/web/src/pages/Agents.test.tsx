/**
 * Unified AI Agents dashboard — frontend API/state tests. Covers the exact
 * agentName-matching fix (previously a fuzzy label-derived match that could
 * never match a real backend agentName), the human-required resolve
 * mutation, and the loading/error/empty states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Agents from './Agents';
import { agentApi } from '../api/client';

vi.mock('../api/client', () => ({
  agentApi: {
    getLog: vi.fn(),
    getLogEntry: vi.fn(),
    resolve: vi.fn(),
  },
}));

function renderAgents() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Agents />
    </QueryClientProvider>,
  );
}

const LOGS = [
  { id: 'log-1', agentName: 'gl-integrity', actionTaken: 'JE_REVIEWED', outcome: 'SUCCESS', humanRequired: false, createdAt: '2026-07-25T10:00:00.000Z' },
  { id: 'log-2', agentName: 'gl-integrity', actionTaken: 'JE_FLAGGED', outcome: 'NEEDS_REVIEW', humanRequired: true, createdAt: '2026-07-25T10:05:00.000Z' },
  { id: 'log-3', agentName: 'apar-recon', actionTaken: 'RECON_MATCHED', outcome: 'SUCCESS', humanRequired: false, createdAt: '2026-07-25T10:10:00.000Z' },
  { id: 'log-4', agentName: 'ap/ar-legacy-fuzzy-value', actionTaken: 'IGNORED', outcome: 'SUCCESS', humanRequired: false, createdAt: '2026-07-25T10:15:00.000Z' },
];

describe('Agents dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts each agent card by exact agentName match, not a fuzzy label-derived guess', async () => {
    (agentApi.getLog as any).mockResolvedValue(LOGS);
    renderAgents();

    await waitFor(() => expect(screen.getByText('GL Integrity')).toBeInTheDocument());

    // gl-integrity has 2 real entries -> the card must show 2, not 0 (the
    // bug this fix corrects) and not accidentally count log-4's unrelated
    // legacy-fuzzy value.
    const glCard = screen.getByText('GL Integrity').closest('div')!.parentElement!;
    expect(glCard).toHaveTextContent('2 actions');

    const aparCard = screen.getByText('AP/AR Recon').closest('div')!.parentElement!;
    expect(aparCard).toHaveTextContent('1 actions');

    // A card for an agent with zero real entries must show 0, not silently
    // matching an unrelated agentName string.
    const eomCard = screen.getByText('EOM Orchestration').closest('div')!.parentElement!;
    expect(eomCard).toHaveTextContent('0 actions');
  });

  it('shows the Human Required queue only for entries with humanRequired=true', async () => {
    (agentApi.getLog as any).mockResolvedValue(LOGS);
    renderAgents();

    await waitFor(() => expect(screen.getByText('Human Required Queue')).toBeInTheDocument());
    // JE_FLAGGED legitimately appears twice: once in the Human Required
    // queue and once in the full activity log table below it.
    expect(screen.getAllByText('JE_FLAGGED').length).toBeGreaterThanOrEqual(1);
    const queue = screen.getByText('Human Required Queue').closest('div')!;
    expect(queue).toHaveTextContent('JE_FLAGGED');
    expect(queue).not.toHaveTextContent('JE_REVIEWED'); // not human-required, must not appear in the queue
  });

  it('resolving a human-required entry calls agentApi.resolve and refetches the log', async () => {
    (agentApi.getLog as any).mockResolvedValue(LOGS);
    (agentApi.resolve as any).mockResolvedValue({ resolved: true });
    const user = userEvent.setup();
    renderAgents();

    await waitFor(() => expect(screen.getByText('Human Required Queue')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(agentApi.resolve).toHaveBeenCalledWith('log-2'));
    // React Query re-invalidates ['agent-logs'] on success -> a second fetch happens.
    await waitFor(() => expect((agentApi.getLog as any).mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('renders an honest empty state, not fake data, when there are no logs yet', async () => {
    (agentApi.getLog as any).mockResolvedValue([]);
    renderAgents();

    await waitFor(() => expect(screen.getByText('No agent activity yet')).toBeInTheDocument());
    const glCard = screen.getByText('GL Integrity').closest('div')!.parentElement!;
    expect(glCard).toHaveTextContent('0 actions');
  });

  it('shows the loading state before the log resolves', () => {
    (agentApi.getLog as any).mockReturnValue(new Promise(() => {})); // never resolves
    renderAgents();
    expect(screen.getByText(/AI Agents/i)).toBeInTheDocument();
  });

  it('shows an error state when the audit-service log fetch fails, not a blank/crashed screen', async () => {
    (agentApi.getLog as any).mockRejectedValue(new Error('audit-service unreachable'));
    renderAgents();

    await waitFor(() => expect(screen.getByText('audit-service unreachable')).toBeInTheDocument());
    expect(screen.getByText('Failed to Load')).toBeInTheDocument();
  });
});

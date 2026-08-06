import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PostingExecutions from './PostingExecutions';
import { postingEngineApi, postingRecoveryApi } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  postingEngineApi: {
    searchExecutions: vi.fn(),
    getExecutionByEventId: vi.fn(),
    submitEvent: vi.fn(),
    simulateEvent: vi.fn(),
    replayExecution: vi.fn(),
    listReplaysForExecution: vi.fn(),
  },
  postingRecoveryApi: {
    listQueue: vi.fn(),
  },
}));

function apiError(status: number, body: any = {}) {
  const err: any = new Error(body.message ?? 'error');
  err.status = status;
  err.body = body;
  return err;
}

function renderScreen() {
  return render(<MemoryRouter><PostingExecutions /></MemoryRouter>);
}

const EXEC = {
  id: 'exec-1', eventId: 'evt-1', eventType: 'accounting.posting-engine.certification.v1', eventSchemaVersion: '1.0',
  sourceEntityId: 'fixture-evt-1', correlationId: 'corr-1', status: 'POSTED',
  rulePackVersionId: 'v1', ruleId: 'unconditional-cert-rule', blueprintHash: 'hash123',
  journalEntryId: 'j1', journalNumber: 'PE-000001', failureReason: null, createdAt: '2026-06-15',
};

describe('PostingExecutions screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ isAuthenticated: true, user: { email: 'reviewer@example.com' }, legalEntityId: 'ENTITY-1', legalEntityLabel: 'Entity One' });
    (postingEngineApi.listReplaysForExecution as any).mockResolvedValue({ items: [] });
    (postingRecoveryApi.listQueue as any).mockResolvedValue({ items: [] });
  });

  it('shows an unauthenticated prompt when not signed in', () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: false, user: null, legalEntityId: null, legalEntityLabel: null });
    renderScreen();
    expect(screen.getByText(/Sign in to view Posting Executions/i)).toBeInTheDocument();
  });

  // CE-07 legal-entity isolation defect — execution inquiry has no
  // consolidated/all-entities view; the screen must gate on a specific
  // legal entity being selected rather than silently searching everything.
  it('prompts to select a legal entity when none is selected, and never calls searchExecutions', () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: true, user: { email: 'reviewer@example.com' }, legalEntityId: null, legalEntityLabel: null });
    renderScreen();
    expect(screen.getByTestId('posting-executions-no-entity')).toBeInTheDocument();
    expect(postingEngineApi.searchExecutions).not.toHaveBeenCalled();
  });

  it('scopes searchExecutions to the session legal entity and shows it as authoritative context', async () => {
    (postingEngineApi.searchExecutions as any).mockResolvedValue({ items: [] });
    renderScreen();
    expect(screen.getByTestId('posting-executions-entity-context')).toHaveTextContent('Entity One');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => expect(postingEngineApi.searchExecutions).toHaveBeenCalledWith('ENTITY-1', expect.any(Object)));
  });

  it('shows a loading state while searching, then results (success state)', async () => {
    let resolveSearch: (v: { items: any[] }) => void;
    (postingEngineApi.searchExecutions as any).mockImplementation(() => new Promise((res) => { resolveSearch = res; }));
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    expect(screen.getByTestId('posting-executions-loading')).toBeInTheDocument();
    resolveSearch!({ items: [EXEC] });
    await waitFor(() => expect(screen.getByTestId('posting-executions-row-evt-1')).toBeInTheDocument());
  });

  it('shows an empty state when the search returns nothing', async () => {
    (postingEngineApi.searchExecutions as any).mockResolvedValue({ items: [] });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => expect(screen.getByTestId('posting-executions-empty')).toBeInTheDocument());
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    (postingEngineApi.searchExecutions as any).mockRejectedValue(apiError(403, { message: 'Missing required permission: posting_engine.execution.view' }));
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => expect(screen.getByTestId('posting-executions-unauthorized')).toBeInTheDocument());
  });

  it('shows a backend-error state on any other failure', async () => {
    (postingEngineApi.searchExecutions as any).mockRejectedValue(apiError(500, { message: 'boom' }));
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => expect(screen.getByTestId('posting-executions-error')).toHaveTextContent('boom'));
  });

  it('shows the posted state with a journal-inquiry link, and no linked recovery case', async () => {
    (postingEngineApi.searchExecutions as any).mockResolvedValue({ items: [EXEC] });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => screen.getByTestId('posting-executions-row-evt-1'));
    await user.click(screen.getByTestId('posting-executions-view-evt-1'));

    expect(screen.getByTestId('posting-executions-posted-state')).toHaveTextContent('PE-000001');
    expect(screen.getByTestId('posting-executions-journal-link')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('posting-executions-no-recovery-case')).toBeInTheDocument());
    expect(screen.getByTestId('posting-executions-replay-empty')).toBeInTheDocument();
  });

  it('shows the no-rule-match state', async () => {
    const exec = { ...EXEC, status: 'NO_RULE_MATCH', journalNumber: null, journalEntryId: null };
    (postingEngineApi.searchExecutions as any).mockResolvedValue({ items: [exec] });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => screen.getByTestId('posting-executions-row-evt-1'));
    await user.click(screen.getByTestId('posting-executions-view-evt-1'));

    expect(screen.getByTestId('posting-executions-no-rule-match-state')).toBeInTheDocument();
    expect(screen.getByTestId('posting-executions-replay-action')).toBeInTheDocument();
  });

  it('shows the rejected/posting-failure state with the failure reason', async () => {
    const exec = { ...EXEC, status: 'REJECTED', journalNumber: null, journalEntryId: null, failureReason: 'Debits do not equal credits' };
    (postingEngineApi.searchExecutions as any).mockResolvedValue({ items: [exec] });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => screen.getByTestId('posting-executions-row-evt-1'));
    await user.click(screen.getByTestId('posting-executions-view-evt-1'));

    expect(screen.getByTestId('posting-executions-rejected-state')).toHaveTextContent('Debits do not equal credits');
  });

  it('shows the linked S021 recovery case for a failed execution', async () => {
    const exec = { ...EXEC, status: 'REJECTED', journalNumber: null, journalEntryId: null, failureReason: 'Unknown account' };
    (postingEngineApi.searchExecutions as any).mockResolvedValue({ items: [exec] });
    (postingRecoveryApi.listQueue as any).mockResolvedValue({ items: [{ id: 'case-1', status: 'QUARANTINED' }] });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => screen.getByTestId('posting-executions-row-evt-1'));
    await user.click(screen.getByTestId('posting-executions-view-evt-1'));

    await waitFor(() => expect(screen.getByTestId('posting-executions-recovery-case-link')).toHaveTextContent('QUARANTINED'));
  });

  it('replays an eligible execution and shows the replay evidence', async () => {
    const exec = { ...EXEC, status: 'NO_RULE_MATCH', journalNumber: null, journalEntryId: null };
    (postingEngineApi.searchExecutions as any).mockResolvedValue({ items: [exec] });
    (postingEngineApi.replayExecution as any).mockResolvedValue({ executionId: 'exec-1', eventId: 'evt-1', status: 'POSTED', idempotent: false, journalNumber: 'PE-000002' });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => screen.getByTestId('posting-executions-row-evt-1'));
    await user.click(screen.getByTestId('posting-executions-view-evt-1'));

    await waitFor(() => screen.getByTestId('posting-executions-replay-action'));
    fireEvent.change(screen.getByPlaceholderText('Why this execution is being replayed'), { target: { value: 'corrected pack now active' } });
    await user.click(screen.getByTestId('posting-executions-replay-button'));

    await waitFor(() => expect(postingEngineApi.replayExecution).toHaveBeenCalledWith('exec-1', 'corrected pack now active'));
    await waitFor(() => expect(screen.getByTestId('posting-executions-replay-notice')).toHaveTextContent('POSTED'));
  });

  it('submits a simulation and shows the proposed balanced-journal preview without posting', async () => {
    (postingEngineApi.simulateEvent as any).mockResolvedValue({
      wouldPost: true, status: 'WOULD_POST', rulePackVersionId: 'v1', ruleId: 'rule-1',
      proposedJournal: { entityId: 'e1', date: '2026-08-01', sourceCode: 'AP', lines: [{ accountNumber: '65000', storeId: 'CENTRAL', dr: 400, cr: 0, memo: 'Invoice' }, { accountNumber: '26000', storeId: 'CENTRAL', dr: 0, cr: 400, memo: 'Invoice' }] },
    });
    renderScreen();
    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId('posting-executions-simulate-envelope-json'), { target: { value: '{"eventId":"evt-1"}' } });
    await user.click(screen.getByTestId('posting-executions-simulate-button'));

    await waitFor(() => expect(screen.getByTestId('posting-executions-simulate-result')).toHaveTextContent('WOULD_POST'));
    expect(screen.getByTestId('posting-executions-proposed-journal')).toHaveTextContent('65000');
    expect(postingEngineApi.submitEvent).not.toHaveBeenCalled();
  });

  it('submitting an event shows the duplicate no-op state when the result is idempotent', async () => {
    (postingEngineApi.submitEvent as any).mockResolvedValue({ executionId: 'exec-1', eventId: 'evt-1', status: 'POSTED', idempotent: true, journalNumber: 'PE-000001' });
    renderScreen();
    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId('posting-executions-submit-envelope-json'), { target: { value: '{"eventId":"evt-1"}' } });
    await user.click(screen.getByTestId('posting-executions-submit-event-button'));

    await waitFor(() => expect(screen.getByTestId('posting-executions-duplicate-noop-state')).toHaveTextContent('duplicate no-op'));
  });

  it('submitting a conflicting event shows the identity-conflict state', async () => {
    (postingEngineApi.submitEvent as any).mockRejectedValue(
      apiError(409, { error: 'EVENT_IDENTITY_CONFLICT', executionId: 'exec-1', eventId: 'evt-1' }),
    );
    renderScreen();
    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId('posting-executions-submit-envelope-json'), { target: { value: '{"eventId":"evt-1"}' } });
    await user.click(screen.getByTestId('posting-executions-submit-event-button'));

    await waitFor(() => expect(screen.getByTestId('posting-executions-identity-conflict-state')).toHaveTextContent('evt-1'));
  });
});

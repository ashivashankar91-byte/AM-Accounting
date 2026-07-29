import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PostingExecutions from './PostingExecutions';
import { postingEngineApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  postingEngineApi: {
    searchExecutions: vi.fn(),
    getExecutionByEventId: vi.fn(),
    submitEvent: vi.fn(),
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
  beforeEach(() => { vi.clearAllMocks(); });

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

  it('shows an unauthorized state on a 401', async () => {
    (postingEngineApi.searchExecutions as any).mockRejectedValue(apiError(401));
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => expect(screen.getByTestId('posting-executions-unauthorized')).toBeInTheDocument());
  });

  it('shows a forbidden state on a 403', async () => {
    (postingEngineApi.searchExecutions as any).mockRejectedValue(apiError(403));
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => expect(screen.getByTestId('posting-executions-forbidden')).toBeInTheDocument());
  });

  it('shows a backend-error state on any other failure', async () => {
    (postingEngineApi.searchExecutions as any).mockRejectedValue(apiError(500, { message: 'boom' }));
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => expect(screen.getByTestId('posting-executions-error')).toHaveTextContent('boom'));
  });

  it('shows the posted state with a journal-inquiry link when a POSTED execution is selected', async () => {
    (postingEngineApi.searchExecutions as any).mockResolvedValue({ items: [EXEC] });
    renderScreen();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-executions-search-button'));
    await waitFor(() => screen.getByTestId('posting-executions-row-evt-1'));
    await user.click(screen.getByTestId('posting-executions-view-evt-1'));

    expect(screen.getByTestId('posting-executions-posted-state')).toHaveTextContent('PE-000001');
    expect(screen.getByTestId('posting-executions-journal-link')).toBeInTheDocument();
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

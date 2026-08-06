import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PostingRecoveryCaseDetail from './PostingRecoveryCaseDetail';
import { postingRecoveryApi } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  postingRecoveryApi: {
    getCase: vi.fn(),
    getAttempts: vi.fn(),
    getCorrections: vi.fn(),
    getLineage: vi.fn(),
    getAuditTimeline: vi.fn(),
    replay: vi.fn(),
  },
}));

const CASE_ID = '11111111-1111-1111-1111-111111111111';

const FAKE_CASE = {
  id: CASE_ID,
  status: 'QUARANTINED',
  sourceEventId: 'evt-1',
  sourceEventType: 'DEAL_POSTED',
  sourceSystem: 'deal-service',
  sourceEntityType: 'DEAL',
  sourceTransactionId: 'DEAL-1',
  correlationId: 'corr-1234',
  causationId: null,
  originalEventTimestamp: '2026-07-01T00:00:00.000Z',
  businessDate: '2026-07-01',
  postingIdempotencyKey: '***1234',
  payload: { dealNumber: 'DEAL-1', ssn: '***6789' },
  payloadRedacted: false,
  containsSensitiveData: true,
  firstFailureAt: '2026-07-01T00:05:00.000Z',
  latestFailureAt: '2026-07-01T00:05:00.000Z',
  latestFailureCategory: 'RULE_NOT_FOUND',
  latestFailureCode: 'RULE_PACK_NOT_FOUND',
  latestFailureMessage: 'No rule pack matched',
  attemptCount: 1,
  assignedOwner: null,
  escalationState: null,
  journalReference: null,
  version: 1,
  canReplay: true,
  replayEligible: false,
  missingReplayFields: [],
  failures: [{
    id: 'f-1', failureCategory: 'RULE_NOT_FOUND', failureCode: 'RULE_PACK_NOT_FOUND',
    failureStage: 'RULE_RESOLUTION', failureMessage: 'No rule pack matched',
    fieldErrors: null, ruleContext: { rulePackVersion: '1.0.0' }, occurredAt: '2026-07-01T00:05:00.000Z',
  }],
};

function renderDetail(id = CASE_ID) {
  return render(
    <MemoryRouter initialEntries={[`/accounting/gl/posting-recovery/${id}`]}>
      <Routes>
        <Route path="/accounting/gl/posting-recovery/:id" element={<PostingRecoveryCaseDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PostingRecoveryCaseDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ isAuthenticated: true });
    (postingRecoveryApi.getAttempts as any).mockResolvedValue({ items: [] });
    (postingRecoveryApi.getCorrections as any).mockResolvedValue({ items: [] });
    (postingRecoveryApi.getLineage as any).mockResolvedValue({
      sourceEventId: 'evt-1', sourceSystem: 'deal-service', sourceTransactionId: 'DEAL-1', transitions: [],
    });
    (postingRecoveryApi.getAuditTimeline as any).mockResolvedValue({ items: [] });
  });

  it('shows a loading state while fetching', async () => {
    (postingRecoveryApi.getCase as any).mockReturnValue(new Promise(() => {}));
    renderDetail();
    expect(screen.getByTestId('prd-loading')).toBeInTheDocument();
  });

  it('renders case detail, original timestamp, correlation id, and idempotency identity', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    renderDetail();
    expect(await screen.findByTestId('posting-recovery-case-detail')).toBeInTheDocument();
    expect(screen.getByTestId('prd-correlation-id')).toHaveTextContent('corr-1234');
    expect(screen.getByTestId('prd-source-transaction-id')).toHaveTextContent('DEAL-1');
    expect(screen.getByTestId('prd-idempotency-key')).toHaveTextContent('***1234');
  });

  it('renders the masked payload as returned by the API', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    renderDetail();
    const payloadEl = await screen.findByTestId('prd-payload');
    expect(payloadEl.textContent).toContain('***6789');
    expect(payloadEl.textContent).not.toContain('123-45-6789');
  });

  it('renders the unmasked payload when the API returns it unmasked (sensitive permission granted)', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue({ ...FAKE_CASE, payload: { dealNumber: 'DEAL-1', ssn: '123-45-6789' } });
    renderDetail();
    const payloadEl = await screen.findByTestId('prd-payload');
    expect(payloadEl.textContent).toContain('123-45-6789');
  });

  it('shows a redacted-payload message when the API omits the payload (no payload.read permission)', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue({ ...FAKE_CASE, payload: null, payloadRedacted: true });
    renderDetail();
    expect(await screen.findByTestId('prd-payload-redacted')).toBeInTheDocument();
  });

  it('renders failure details, stage, code, and CH01 rule context', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    renderDetail();
    await screen.findByTestId('posting-recovery-case-detail');
    expect(screen.getByTestId('prd-failure-details')).toHaveTextContent('RULE_RESOLUTION');
    expect(screen.getByTestId('prd-failure-details')).toHaveTextContent('RULE_PACK_NOT_FOUND');
    expect(screen.getByTestId('prd-rule-context')).toHaveTextContent('rulePackVersion');
  });

  it('renders replay-attempt history when attempts exist, and an empty message otherwise', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    (postingRecoveryApi.getAttempts as any).mockResolvedValue({
      items: [{ id: 'a-1', attemptNumber: 1, status: 'FAILED', requestedAt: '2026-07-01T01:00:00.000Z', resultMessage: 'still unresolved' }],
    });
    renderDetail();
    expect(await screen.findByTestId('prd-attempts')).toHaveTextContent('FAILED');
  });

  it('shows an empty attempts message when there is no attempt history', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    renderDetail();
    expect(await screen.findByTestId('prd-attempts-empty')).toBeInTheDocument();
  });

  it('renders correction history when corrections exist', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    (postingRecoveryApi.getCorrections as any).mockResolvedValue({
      items: [{ id: 'c-1', revisionNumber: 1, correctionType: 'FIELD_CORRECTION', description: 'fix mapping', status: 'PROPOSED' }],
    });
    renderDetail();
    expect(await screen.findByTestId('prd-corrections')).toHaveTextContent('FIELD_CORRECTION');
  });

  it('renders source-to-failure lineage', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    renderDetail();
    expect(await screen.findByTestId('prd-lineage')).toHaveTextContent('DEAL-1');
  });

  it('renders the audit timeline', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    (postingRecoveryApi.getAuditTimeline as any).mockResolvedValue({
      items: [{ id: 'aud-1', eventType: 'posting_recovery.case_viewed', actor: 'user-1', occurredAt: '2026-07-01T02:00:00.000Z' }],
    });
    renderDetail();
    expect(await screen.findByTestId('prd-audit-timeline')).toHaveTextContent('posting_recovery.case_viewed');
  });

  it('shows the not-found state for a well-formed but missing case id', async () => {
    const err: any = new Error('not found');
    err.status = 404;
    (postingRecoveryApi.getCase as any).mockRejectedValue(err);
    renderDetail();
    expect(await screen.findByTestId('prd-not-found')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('Missing required permission: posting-recovery.case.read');
    err.status = 403;
    (postingRecoveryApi.getCase as any).mockRejectedValue(err);
    renderDetail();
    expect(await screen.findByTestId('prd-unauthorized')).toBeInTheDocument();
  });

  it('shows an audit-section-scoped unauthorized state when audit.read is denied but case.read is granted', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue(FAKE_CASE);
    const err: any = new Error('Missing required permission: posting-recovery.audit.read');
    err.status = 403;
    (postingRecoveryApi.getAuditTimeline as any).mockRejectedValue(err);
    renderDetail();
    expect(await screen.findByTestId('prd-audit-unauthorized')).toBeInTheDocument();
  });

  it('shows a generic error state on an unexpected API failure', async () => {
    (postingRecoveryApi.getCase as any).mockRejectedValue(new Error('boom'));
    renderDetail();
    expect(await screen.findByTestId('prd-error')).toBeInTheDocument();
  });

  // ── R1 S021-completion: replay action ─────────────────────────────────────

  it('disables the replay action with a permission message when canReplay is false', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue({ ...FAKE_CASE, canReplay: false, replayEligible: true, status: 'READY_FOR_REPLAY' });
    renderDetail();
    await screen.findByTestId('posting-recovery-case-detail');
    const btn = screen.getByRole('button', { name: /no permission/i });
    expect(btn).toBeDisabled();
    expect(postingRecoveryApi.replay).not.toHaveBeenCalled();
  });

  it('disables the replay action with an eligibility message when the case status is not READY_FOR_REPLAY', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue({ ...FAKE_CASE, canReplay: true, replayEligible: false, status: 'QUARANTINED' });
    renderDetail();
    await screen.findByTestId('posting-recovery-case-detail');
    const btn = screen.getByRole('button', { name: /not eligible/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', expect.stringContaining('READY_FOR_REPLAY'));
  });

  it('disables the replay action listing missing fields when status is READY_FOR_REPLAY but the envelope is incomplete', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue({
      ...FAKE_CASE, canReplay: true, replayEligible: false, status: 'READY_FOR_REPLAY', missingReplayFields: ['eventSchemaVersion', 'businessDate'],
    });
    renderDetail();
    await screen.findByTestId('posting-recovery-case-detail');
    const btn = screen.getByRole('button', { name: /not eligible/i });
    expect(btn).toHaveAttribute('title', expect.stringContaining('eventSchemaVersion'));
  });

  it('shows a disabled in-progress state when the case is already REPLAY_IN_PROGRESS', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue({ ...FAKE_CASE, canReplay: true, replayEligible: false, status: 'REPLAY_IN_PROGRESS' });
    renderDetail();
    expect(await screen.findByTestId('prd-replay-in-progress')).toBeDisabled();
  });

  it('enables the replay button when eligible and permitted, executes replay, shows the success result, and refreshes the case', async () => {
    (postingRecoveryApi.getCase as any)
      .mockResolvedValueOnce({ ...FAKE_CASE, canReplay: true, replayEligible: true, status: 'READY_FOR_REPLAY' })
      .mockResolvedValueOnce({ ...FAKE_CASE, canReplay: true, replayEligible: false, status: 'RESOLVED', journalReference: 'JE-100' });
    (postingRecoveryApi.replay as any).mockResolvedValue({
      deadLetterId: CASE_ID, attemptNumber: 1, outcome: 'POSTED', message: 'Posted as journal JE-100.', journalReference: 'JE-100', status: 'RESOLVED', idempotentPassthrough: false,
    });
    renderDetail();

    const btn = await screen.findByTestId('prd-replay-button');
    btn.click();

    const result = await screen.findByTestId('prd-replay-result');
    expect(result).toHaveTextContent('POSTED');
    expect(result).toHaveTextContent('JE-100');
    expect(postingRecoveryApi.replay).toHaveBeenCalledWith(CASE_ID);
    expect(postingRecoveryApi.getCase).toHaveBeenCalledTimes(2); // initial load + post-replay refresh
    // The refresh re-fetched the case (now RESOLVED with a journal reference) —
    // asserted via the journal-reference line rather than Badge's data-testid,
    // since Badge (pre-existing, not part of this change) doesn't forward
    // data-testid to the DOM.
    await waitFor(() => expect(screen.getByText(/Journal reference:/)).toBeInTheDocument());
    expect(screen.getAllByText('JE-100').length).toBeGreaterThan(0);
  });

  it('shows a conflict result when a replay is already in progress (409) without crashing the page', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue({ ...FAKE_CASE, canReplay: true, replayEligible: true, status: 'READY_FOR_REPLAY' });
    const err: any = new Error('Case was concurrently claimed for replay by another request.');
    err.status = 409;
    (postingRecoveryApi.replay as any).mockRejectedValue(err);
    renderDetail();

    const btn = await screen.findByTestId('prd-replay-button');
    btn.click();

    expect(await screen.findByTestId('prd-replay-error')).toHaveTextContent('concurrently claimed');
  });

  it('shows a posting-failure result distinctly from a success result', async () => {
    (postingRecoveryApi.getCase as any).mockResolvedValue({ ...FAKE_CASE, canReplay: true, replayEligible: true, status: 'READY_FOR_REPLAY' });
    (postingRecoveryApi.replay as any).mockResolvedValue({
      deadLetterId: CASE_ID, attemptNumber: 1, outcome: 'REJECTED', message: 'Blueprint failed defensive verification.', journalReference: null, status: 'UNDER_REVIEW', idempotentPassthrough: false,
    });
    renderDetail();

    const btn = await screen.findByTestId('prd-replay-button');
    btn.click();

    const result = await screen.findByTestId('prd-replay-result');
    expect(result).toHaveTextContent('REJECTED');
    expect(result).toHaveTextContent('Blueprint failed defensive verification.');
    expect(result.className).not.toContain('emerald'); // visually distinct from the success (green) styling
  });
});

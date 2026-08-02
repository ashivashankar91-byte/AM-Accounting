import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PostingRules from './PostingRules';
import { postingEngineApi, goldenPathApi } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  postingEngineApi: {
    listRulePacks: vi.fn(),
    getRulePack: vi.fn(),
    validateDraft: vi.fn(),
    createRulePackVersion: vi.fn(),
    validateVersion: vi.fn(),
    activateVersion: vi.fn(),
  },
  goldenPathApi: {
    getAuditHistory: vi.fn(),
  },
}));

function apiError(status: number, body: any = {}) {
  const err: any = new Error(body.message ?? 'error');
  err.status = status;
  err.body = body;
  return err;
}

function renderScreen() {
  return render(<MemoryRouter><PostingRules /></MemoryRouter>);
}

const VALIDATED_VERSION = {
  id: 'v1', packKey: 'cert-pack', semver: '1.0.0', status: 'VALIDATED', eventType: 'x',
  entityId: 'ENTITY-1', journalSourceCode: 'AP', matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
  effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, contentHash: 'abc123def456',
  createdAt: '2026-01-01', createdBy: 'author-1', validatedAt: '2026-01-01', activatedBy: null, activatedAt: null,
  validationFindings: [], definition: { rules: [] },
};

describe('PostingRules screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ isAuthenticated: true, user: { email: 'author-1@example.com' }, legalEntityId: 'ENTITY-1', legalEntityLabel: 'Entity One' });
    (goldenPathApi.getAuditHistory as any).mockResolvedValue([]);
  });

  it('shows an unauthenticated prompt when not signed in', () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: false, user: null, legalEntityId: null, legalEntityLabel: null });
    renderScreen();
    expect(screen.getByText(/Sign in to view Posting Rules/i)).toBeInTheDocument();
  });

  // CE-07 legal-entity isolation defect — rule-pack governance has no
  // consolidated/all-entities view; the screen must gate on a specific
  // legal entity being selected rather than silently listing everything.
  it('prompts to select a legal entity when none is selected, and never calls listRulePacks', () => {
    (useAuth as any).mockReturnValue({ isAuthenticated: true, user: { email: 'author-1@example.com' }, legalEntityId: null, legalEntityLabel: null });
    renderScreen();
    expect(screen.getByTestId('posting-rules-no-entity')).toBeInTheDocument();
    expect(postingEngineApi.listRulePacks).not.toHaveBeenCalled();
  });

  it('scopes listRulePacks to the session legal entity and shows it as authoritative context', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({ items: [] });
    renderScreen();
    await waitFor(() => expect(postingEngineApi.listRulePacks).toHaveBeenCalledWith('ENTITY-1'));
    expect(screen.getByTestId('posting-rules-entity-context')).toHaveTextContent('Entity One');
  });

  it('shows a loading state, then the empty state when there are no rule packs', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({ items: [] });
    renderScreen();
    expect(screen.getByTestId('posting-rules-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('posting-rules-empty')).toBeInTheDocument());
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    (postingEngineApi.listRulePacks as any).mockRejectedValue(apiError(403, { message: 'Missing required permission: posting_engine.rule_pack.view' }));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('posting-rules-unauthorized')).toBeInTheDocument());
    expect(screen.getByText(/posting_engine.rule_pack.view/)).toBeInTheDocument();
  });

  it('shows a backend-error state on any other failure', async () => {
    (postingEngineApi.listRulePacks as any).mockRejectedValue(apiError(500, { message: 'boom' }));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('posting-rules-error')).toHaveTextContent('boom'));
  });

  it('shows the rule-pack list on success (success state)', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({
      items: [{ pack: { id: 'p1', packKey: 'cert-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [] }],
    });
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('posting-rules-pack-cert-pack')).toBeInTheDocument());
  });

  it('filters the pack list by status (both packs already belong to the one scoped legal entity)', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({
      items: [
        { pack: { id: 'p1', packKey: 'ap-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [{ ...VALIDATED_VERSION, id: 'v1', packKey: 'ap-pack', entityId: 'ENTITY-1', status: 'ACTIVE' }] },
        { pack: { id: 'p2', packKey: 'ar-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [{ ...VALIDATED_VERSION, id: 'v2', packKey: 'ar-pack', entityId: 'ENTITY-1', status: 'DRAFT' }] },
      ],
    });
    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-pack-list'));
    expect(screen.getByTestId('posting-rules-pack-ap-pack')).toBeInTheDocument();
    expect(screen.getByTestId('posting-rules-pack-ar-pack')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('posting-rules-filter-status'), { target: { value: 'ACTIVE' } });
    expect(screen.getByTestId('posting-rules-pack-ap-pack')).toBeInTheDocument();
    expect(screen.queryByTestId('posting-rules-pack-ar-pack')).not.toBeInTheDocument();
  });

  it('runs draft validation and renders structured findings on failure', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({ items: [] });
    (postingEngineApi.validateDraft as any).mockResolvedValue({
      valid: false,
      findings: [{ severity: 'ERROR', code: 'DEBIT_BP_NOT_10000', path: '$.rules[0]', message: 'debit bp must total 10000' }],
    });
    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-empty'));

    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-rules-new-draft'));
    fireEvent.change(screen.getByTestId('posting-rules-draft-pack-key'), { target: { value: 'new-pack' } });
    fireEvent.change(screen.getByTestId('posting-rules-draft-event-type'), { target: { value: 'ap.invoice.accepted.v1' } });
    await user.click(screen.getByTestId('posting-rules-validate-draft'));

    await waitFor(() => expect(screen.getByTestId('posting-rules-draft-valid')).toHaveTextContent('Invalid'));
    expect(screen.getByTestId('posting-rules-draft-finding-0')).toHaveTextContent('DEBIT_BP_NOT_10000');
  });

  it('runs draft validation and shows success, then saves the draft', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({ items: [] });
    (postingEngineApi.validateDraft as any).mockResolvedValue({ valid: true, findings: [] });
    (postingEngineApi.createRulePackVersion as any).mockResolvedValue({ id: 'v-new' });
    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-empty'));

    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-rules-new-draft'));
    fireEvent.change(screen.getByTestId('posting-rules-draft-pack-key'), { target: { value: 'new-pack' } });
    fireEvent.change(screen.getByTestId('posting-rules-draft-event-type'), { target: { value: 'ap.invoice.accepted.v1' } });
    await user.click(screen.getByTestId('posting-rules-validate-draft'));
    await waitFor(() => expect(screen.getByTestId('posting-rules-draft-valid')).toHaveTextContent('Valid'));

    await user.click(screen.getByTestId('posting-rules-save-draft'));
    await waitFor(() => expect(postingEngineApi.createRulePackVersion).toHaveBeenCalledWith('new-pack', expect.any(String)));
  });

  it('renders an activated version as read-only/immutable', async () => {
    const version = { ...VALIDATED_VERSION, id: 'v1', status: 'ACTIVE', activatedBy: 'admin', activatedAt: '2026-01-02' };
    (postingEngineApi.listRulePacks as any).mockResolvedValue({
      items: [{ pack: { id: 'p1', packKey: 'cert-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [version] }],
    });
    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-pack-cert-pack'));

    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-rules-select-cert-pack'));
    await user.click(screen.getByTestId('posting-rules-view-v1'));

    await waitFor(() => expect(screen.getByTestId('posting-rules-version-detail-status')).toHaveTextContent('ACTIVE'));
    expect(screen.queryByTestId('posting-rules-activate-version-v1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('posting-rules-validate-version-v1')).not.toBeInTheDocument();
  });

  it('a generic activation failure surfaces the backend error message', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({
      items: [{ pack: { id: 'p1', packKey: 'cert-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [VALIDATED_VERSION] }],
    });
    (postingEngineApi.activateVersion as any).mockRejectedValue(apiError(422, { message: 'Rule pack version is "DRAFT" — only a VALIDATED version may be activated.' }));

    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-pack-cert-pack'));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-rules-select-cert-pack'));
    await user.click(screen.getByTestId('posting-rules-view-v1'));
    await user.click(screen.getByTestId('posting-rules-activate-version-v1'));

    await waitFor(() => expect(screen.getByTestId('posting-rules-action-error')).toHaveTextContent('VALIDATED'));
  });

  it('refuses self-activation with a clear, specific message (author cannot activate their own version)', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({
      items: [{ pack: { id: 'p1', packKey: 'cert-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [VALIDATED_VERSION] }],
    });
    (postingEngineApi.activateVersion as any).mockRejectedValue(apiError(403, { error: 'SELF_ACTIVATION_FORBIDDEN', message: 'author cannot self-activate' }));

    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-pack-cert-pack'));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-rules-select-cert-pack'));
    await user.click(screen.getByTestId('posting-rules-view-v1'));
    await user.click(screen.getByTestId('posting-rules-activate-version-v1'));

    await waitFor(() => expect(screen.getByTestId('posting-rules-action-error')).toHaveTextContent(/separate, eligible user must activate/i));
  });

  it('shows the before/after audit trail for a version', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({
      items: [{ pack: { id: 'p1', packKey: 'cert-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [VALIDATED_VERSION] }],
    });
    (goldenPathApi.getAuditHistory as any).mockResolvedValue([
      { id: 'a1', action: 'VALIDATION_COMPLETED', actor: 'author-1', before: { status: 'DRAFT' }, after: { status: 'VALIDATED' }, occurredAt: '2026-01-01T00:00:00.000Z' },
    ]);

    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-pack-cert-pack'));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-rules-select-cert-pack'));
    await user.click(screen.getByTestId('posting-rules-view-v1'));

    await waitFor(() => expect(screen.getByTestId('posting-rules-audit-diff')).toHaveTextContent('VALIDATION_COMPLETED'));
    expect(screen.getByTestId('posting-rules-audit-diff')).toHaveTextContent('DRAFT');
    expect(screen.getByTestId('posting-rules-audit-diff')).toHaveTextContent('VALIDATED');
  });
});

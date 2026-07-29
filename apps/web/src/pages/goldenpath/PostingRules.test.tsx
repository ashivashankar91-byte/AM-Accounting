import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PostingRules from './PostingRules';
import { postingEngineApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  postingEngineApi: {
    listRulePacks: vi.fn(),
    validateDraft: vi.fn(),
    createRulePackVersion: vi.fn(),
    validateVersion: vi.fn(),
    activateVersion: vi.fn(),
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

describe('PostingRules screen', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a loading state, then the empty state when there are no rule packs', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({ items: [] });
    renderScreen();
    expect(screen.getByTestId('posting-rules-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('posting-rules-empty')).toBeInTheDocument());
  });

  it('shows an unauthorized state on a 401', async () => {
    (postingEngineApi.listRulePacks as any).mockRejectedValue(apiError(401));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('posting-rules-unauthorized')).toBeInTheDocument());
  });

  it('shows a forbidden state on a 403', async () => {
    (postingEngineApi.listRulePacks as any).mockRejectedValue(apiError(403));
    renderScreen();
    await waitFor(() => expect(screen.getByTestId('posting-rules-forbidden')).toBeInTheDocument());
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

  it('runs draft validation and renders structured findings on failure', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({ items: [] });
    (postingEngineApi.validateDraft as any).mockResolvedValue({
      valid: false,
      findings: [{ severity: 'ERROR', code: 'DEBIT_BP_NOT_10000', path: '$.rules[0]', message: 'debit bp must total 10000' }],
    });
    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-empty'));

    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId('posting-rules-draft-json'), { target: { value: '{"dslVersion":1}' } });
    await user.click(screen.getByTestId('posting-rules-validate-draft'));

    await waitFor(() => expect(screen.getByTestId('posting-rules-draft-valid')).toHaveTextContent('Invalid'));
    expect(screen.getByTestId('posting-rules-draft-finding-0')).toHaveTextContent('DEBIT_BP_NOT_10000');
  });

  it('runs draft validation and shows success', async () => {
    (postingEngineApi.listRulePacks as any).mockResolvedValue({ items: [] });
    (postingEngineApi.validateDraft as any).mockResolvedValue({ valid: true, findings: [] });
    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-empty'));

    const user = userEvent.setup();
    fireEvent.change(screen.getByTestId('posting-rules-draft-json'), { target: { value: '{"dslVersion":1}' } });
    await user.click(screen.getByTestId('posting-rules-validate-draft'));

    await waitFor(() => expect(screen.getByTestId('posting-rules-draft-valid')).toHaveTextContent('Valid'));
  });

  it('renders an activated version as read-only/immutable', async () => {
    const version = {
      id: 'v1', packKey: 'cert-pack', semver: '1.0.0', status: 'ACTIVE', eventType: 'x',
      effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, contentHash: 'abc123def456',
      createdAt: '2026-01-01', validatedAt: '2026-01-01', activatedBy: 'admin', activatedAt: '2026-01-02', validationFindings: [],
    };
    (postingEngineApi.listRulePacks as any).mockResolvedValue({
      items: [{ pack: { id: 'p1', packKey: 'cert-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [version] }],
    });
    renderScreen();
    await waitFor(() => screen.getByTestId('posting-rules-pack-cert-pack'));

    const user = userEvent.setup();
    await user.click(screen.getByTestId('posting-rules-select-cert-pack'));
    await user.click(screen.getByTestId('posting-rules-view-v1'));

    expect(screen.getByTestId('posting-rules-version-readonly')).toHaveTextContent('active and immutable');
    expect(screen.queryByTestId('posting-rules-activate-version-v1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('posting-rules-validate-version-v1')).not.toBeInTheDocument();
  });

  it('activation failure surfaces the backend error message', async () => {
    const version = {
      id: 'v1', packKey: 'cert-pack', semver: '1.0.0', status: 'VALIDATED', eventType: 'x',
      effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, contentHash: 'abc123def456',
      createdAt: '2026-01-01', validatedAt: '2026-01-01', activatedBy: null, activatedAt: null, validationFindings: [],
    };
    (postingEngineApi.listRulePacks as any).mockResolvedValue({
      items: [{ pack: { id: 'p1', packKey: 'cert-pack', createdBy: 'admin', createdAt: '2026-01-01' }, versions: [version] }],
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
});

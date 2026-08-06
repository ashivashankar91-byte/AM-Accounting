/**
 * CE-17 — Automation Command Center.
 *
 * These tests hold the screen to the epic's central promise: it never claims
 * more than the service told it. An unconfigured capability is shown as
 * unconfigured, an empty queue is explained rather than hidden, and a refusal
 * is presented as a refusal rather than as a failure.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AutomationCommandCenter from '../index';
import { automationApi } from '../../../../api/client';
import { resolveAllEmpty, pending, wrap, refusal } from './test-helpers';

vi.mock('../../../../api/client', async () => (await import('./test-helpers')).automationApiMockModule());

const api = automationApi as any;

const OVERVIEW = {
  capabilityCount: 14,
  configuredCount: 3,
  observeOnlyCount: 2,
  autoCount: 0,
  suspendedCount: 1,
  approvalQueueDepth: 4,
  failedClosedCount: 1,
  itemsByState: { RECOMMENDATION_READY: 3, APPROVAL_REQUIRED: 4, FAILED_CLOSED: 1 },
  capabilities: [
    {
      capabilityCode: 'S040_OCR_INGESTION', storyId: 'S040', label: 'OCR/EDI Invoice Ingestion',
      ceiling: 'AUTO_EXECUTE_WITHIN_POLICY', currentAuthority: 'OBSERVE_ONLY', configured: true,
    },
    {
      capabilityCode: 'S126_DSAR', storyId: 'S126', label: 'DSAR Automation',
      ceiling: 'EXECUTE_WITH_APPROVAL', currentAuthority: 'NOT_CONFIGURED', configured: false,
    },
  ],
};

describe('AutomationCommandCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
  });

  it('holds a loading state while the overview is being fetched', () => {
    api.getOverview.mockReturnValue(pending());
    wrap(<AutomationCommandCenter />);
    expect(screen.getByText(/loading accounting automation/i)).toBeTruthy();
  });

  it('reports the epic position from the service, not from the rows it happens to have', async () => {
    api.getOverview.mockResolvedValue(OVERVIEW);
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('automation-position')).toBeTruthy());
    expect(screen.getByTestId('stat-capability-count').textContent).toBe('14');
    expect(screen.getByTestId('stat-configured-count').textContent).toBe('3');
    expect(screen.getByTestId('stat-observe-only-count').textContent).toBe('2');
    expect(screen.getByTestId('stat-approval-queue-depth').textContent).toBe('4');
    expect(screen.getByTestId('stat-failed-closed-count').textContent).toBe('1');
  });

  it('shows every capability including the ones nobody has configured', async () => {
    api.getOverview.mockResolvedValue(OVERVIEW);
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('capability-row-S040_OCR_INGESTION')).toBeTruthy());
    expect(screen.getByTestId('capability-row-S126_DSAR')).toBeTruthy();
    expect(screen.getByTestId('not-configured-S126_DSAR')).toBeTruthy();
  });

  it('never presents an OBSERVE_ONLY capability as if it were acting', async () => {
    api.getOverview.mockResolvedValue(OVERVIEW);
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('authority-S040_OCR_INGESTION')).toBeTruthy());
    expect(screen.getByTestId('authority-S040_OCR_INGESTION').textContent).toMatch(/observe/i);
    expect(screen.getByTestId('stat-auto-count').textContent).toBe('0');
  });

  it('breaks the queue down by truthful state', async () => {
    api.getOverview.mockResolvedValue(OVERVIEW);
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('items-by-state')).toBeTruthy());
    expect(screen.getByTestId('state-chip-APPROVAL_REQUIRED').textContent).toContain('4');
    expect(screen.getByTestId('state-chip-FAILED_CLOSED').textContent).toContain('1');
  });

  it('explains an empty queue instead of leaving a blank panel', async () => {
    api.getOverview.mockResolvedValue({ ...OVERVIEW, itemsByState: {} });
    api.listItems.mockResolvedValue({ items: [], total: 0 });
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('recent-items-empty')).toBeTruthy());
    expect(screen.getByTestId('recent-items-empty').textContent).toMatch(/OBSERVE_ONLY/);
  });

  it('lists recent items with the state the service assigned them', async () => {
    api.getOverview.mockResolvedValue(OVERVIEW);
    api.listItems.mockResolvedValue({
      items: [
        { id: 'i1', capabilityCode: 'S040_OCR_INGESTION', state: 'APPROVAL_REQUIRED', proposedAmount: '1200.00', createdAt: '2026-02-01T00:00:00Z' },
        { id: 'i2', capabilityCode: 'S058_LOCKBOX_MATCHING', state: 'EXECUTED', proposedAmount: '900.00', createdAt: '2026-02-02T00:00:00Z' },
      ],
      total: 2,
    });
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('recent-item-i1')).toBeTruthy());
    expect(screen.getByTestId('recent-item-i2')).toBeTruthy();
  });

  it('will not send an emergency stop without a stated reason', async () => {
    api.getOverview.mockResolvedValue(OVERVIEW);
    const { container } = wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('emergency-stop-btn')).toBeTruthy());
    (screen.getByTestId('emergency-stop-btn') as HTMLButtonElement).click();
    await waitFor(() => expect(screen.getByTestId('emergency-stop-panel')).toBeTruthy());
    const confirm = screen.getByTestId('emergency-stop-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(api.emergencyStop).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
  });

  it('presents a permission refusal as a refusal, not as an outage', async () => {
    api.getOverview.mockRejectedValue(refusal(403, '403 Forbidden: permission_denied'));
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('automation-command-center-unauthorized')).toBeTruthy());
    expect(screen.queryByTestId('automation-position')).toBeNull();
  });

  it('shows nothing stale beside an error', async () => {
    api.getOverview.mockRejectedValue(new Error('upstream unavailable'));
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('automation-command-center-error')).toBeTruthy());
    expect(screen.queryByTestId('capability-grid')).toBeNull();
    expect(screen.queryByTestId('automation-position')).toBeNull();
  });

  it('offers navigation to the authority ceremony rather than promoting inline', async () => {
    api.getOverview.mockResolvedValue(OVERVIEW);
    wrap(<AutomationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('capability-grid')).toBeTruthy());
    expect(screen.getByText(/manage authority/i)).toBeTruthy();
    expect(api.grantAuthority).not.toHaveBeenCalled();
    expect(api.activateAuthority).not.toHaveBeenCalled();
  });
});

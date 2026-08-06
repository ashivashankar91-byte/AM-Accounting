/**
 * CE-17 — Automation Queue.
 *
 * The queue is where a person decides. These tests hold it to the rules that
 * make that decision meaningful: the full policy trace is shown before
 * anything executes, a separation-of-duties refusal is reported as a refusal,
 * and an item that never executed shows no journal reference.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import AutomationQueue from '../queue';
import { automationApi } from '../../../../api/client';
import { resolveAllEmpty, pending, wrap, refusal } from './test-helpers';

vi.mock('../../../../api/client', async () => (await import('./test-helpers')).automationApiMockModule());

const api = automationApi as any;

const ITEM = {
  id: 'item-1',
  capabilityCode: 'S095_PORTFOLIO_RESERVE',
  storyId: 'S095',
  state: 'APPROVAL_REQUIRED',
  idempotencyKey: 'S095:le-1:2026-02:abc',
  automationIdentity: 'automation:ce17',
  proposedAmount: '4500.00',
  confidence: '0.9210',
  ruleVersion: 'rule-v3',
  modelVersion: null,
  approvalRequired: true,
  approvedBy: null,
  rejectedBy: null,
  retryCount: 0,
  failureReason: null,
  claimedBy: null,
  createdAt: '2026-02-01T00:00:00Z',
};

async function openItem() {
  await waitFor(() => expect(screen.getByTestId('inspect-item-1')).toBeTruthy());
  (screen.getByTestId('inspect-item-1') as HTMLButtonElement).click();
  await waitFor(() => expect(screen.getByTestId('item-detail')).toBeTruthy());
}

describe('AutomationQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
  });

  it('holds a loading state while the queue is being fetched', () => {
    api.listItems.mockReturnValue(pending());
    wrap(<AutomationQueue />);
    expect(screen.getByText(/loading automation queue/i)).toBeTruthy();
  });

  it('explains an empty queue rather than implying nothing is configured', async () => {
    api.listItems.mockResolvedValue({ items: [], total: 0 });
    wrap(<AutomationQueue />);
    await waitFor(() => expect(screen.getByTestId('queue-empty')).toBeTruthy());
    expect(screen.getByTestId('queue-empty').textContent).toMatch(/OBSERVE_ONLY/);
  });

  it('lists items with the truthful state the service assigned', async () => {
    api.listItems.mockResolvedValue({
      items: [ITEM, { ...ITEM, id: 'item-2', state: 'FAILED_CLOSED' }],
      total: 2,
    });
    wrap(<AutomationQueue />);
    await waitFor(() => expect(screen.getByTestId('queue-row-item-1')).toBeTruthy());
    expect(screen.getByTestId('queue-state-item-1').textContent).toMatch(/approval/i);
    expect(screen.getByTestId('queue-state-item-2').textContent).toMatch(/failed/i);
  });

  it('shows an unscored item as unscored rather than as zero confidence', async () => {
    api.listItems.mockResolvedValue({ items: [{ ...ITEM, confidence: null }], total: 1 });
    wrap(<AutomationQueue />);
    await waitFor(() => expect(screen.getByTestId('queue-row-item-1')).toBeTruthy());
    expect(screen.getByTestId('queue-row-item-1').textContent).toContain('Not scored');
  });

  it('shows the idempotency key that makes a replay a no-op', async () => {
    api.listItems.mockResolvedValue({ items: [ITEM], total: 1 });
    api.getItem.mockResolvedValue(ITEM);
    wrap(<AutomationQueue />);
    await openItem();
    expect(screen.getByTestId('item-idempotency-key').textContent).toBe('S095:le-1:2026-02:abc');
    expect(screen.getByTestId('item-automation-identity').textContent).toBe('automation:ce17');
  });

  it('renders every policy gate, the passed ones included', async () => {
    api.listItems.mockResolvedValue({ items: [ITEM], total: 1 });
    api.getItem.mockResolvedValue(ITEM);
    api.evaluateItem.mockResolvedValue({
      allowed: false,
      refusalGate: 'MONETARY_LIMIT',
      refusalReason: 'proposed amount exceeds the configured limit',
      policyVersion: '1.2',
      checks: [
        { gate: 'CAPABILITY_CONFIGURED', passed: true, detail: 'configured' },
        { gate: 'AUTHORITY_SUFFICIENT', passed: true, detail: 'EXECUTE_WITH_APPROVAL' },
        { gate: 'MONETARY_LIMIT', passed: false, detail: 'proposed amount exceeds the configured limit' },
      ],
    });
    wrap(<AutomationQueue />);
    await openItem();
    await waitFor(() => expect(screen.getByTestId('item-policy-trace')).toBeTruthy());
    expect(screen.getByTestId('gate-CAPABILITY_CONFIGURED')).toBeTruthy();
    expect(screen.getByTestId('gate-AUTHORITY_SUFFICIENT')).toBeTruthy();
    expect(screen.getByTestId('gate-MONETARY_LIMIT')).toBeTruthy();
    expect(screen.getByTestId('item-policy-trace-verdict').textContent).toMatch(/MONETARY_LIMIT/);
  });

  it('states that no policy evaluation exists rather than implying every gate passed', async () => {
    api.listItems.mockResolvedValue({ items: [ITEM], total: 1 });
    api.getItem.mockResolvedValue(ITEM);
    api.evaluateItem.mockResolvedValue({ checks: [] });
    wrap(<AutomationQueue />);
    await openItem();
    await waitFor(() => expect(screen.getByTestId('item-policy-trace-empty')).toBeTruthy());
  });

  it('shows no journal reference for an item that never executed', async () => {
    api.listItems.mockResolvedValue({ items: [ITEM], total: 1 });
    api.getItem.mockResolvedValue(ITEM);
    api.getItemLineage.mockResolvedValue({ sourceEvidenceRefs: ['doc://statement-1'], executions: [] });
    wrap(<AutomationQueue />);
    await openItem();
    await waitFor(() => expect(screen.getByTestId('lineage-empty')).toBeTruthy());
    expect(screen.getByTestId('lineage-source-evidence').textContent).toBe('doc://statement-1');
  });

  it('traces an executed item from source evidence to journal entry', async () => {
    api.listItems.mockResolvedValue({ items: [{ ...ITEM, state: 'EXECUTED' }], total: 1 });
    api.getItem.mockResolvedValue({ ...ITEM, state: 'EXECUTED', approvedBy: 'approver-1' });
    api.getItemLineage.mockResolvedValue({
      sourceEvidenceRefs: ['doc://statement-1'],
      executions: [{
        id: 'exec-1', outcome: 'EXECUTED', journalEntryId: 'je-99',
        postingExecutionId: 'pe-99', policyVersion: '1.2', reversalOf: null,
        createdAt: '2026-02-03T00:00:00Z',
      }],
    });
    wrap(<AutomationQueue />);
    await openItem();
    await waitFor(() => expect(screen.getByTestId('execution-exec-1')).toBeTruthy());
    expect(screen.getByTestId('execution-exec-1').textContent).toContain('je-99');
  });

  it('reports a separation-of-duties refusal as a refusal that posted nothing', async () => {
    api.listItems.mockResolvedValue({ items: [ITEM], total: 1 });
    api.getItem.mockResolvedValue(ITEM);
    api.approveItem.mockRejectedValue(refusal(409, 'SEPARATION_OF_DUTIES: the automation identity cannot approve its own recommendation'));
    wrap(<AutomationQueue />);
    await openItem();
    (screen.getByTestId('approve-item') as HTMLButtonElement).click();
    await waitFor(() => expect(screen.getByTestId('approve-error-policy-refused')).toBeTruthy());
    expect(screen.getByTestId('approve-error-policy-refused').textContent).toMatch(/nothing was posted/i);
  });

  it('reports a policy-gate refusal on execute without claiming an outcome', async () => {
    api.listItems.mockResolvedValue({ items: [ITEM], total: 1 });
    api.getItem.mockResolvedValue(ITEM);
    api.executeItem.mockRejectedValue(refusal(422, 'POLICY_GATE_REFUSED: CLOSED_PERIOD'));
    wrap(<AutomationQueue />);
    await openItem();
    (screen.getByTestId('execute-item') as HTMLButtonElement).click();
    await waitFor(() => expect(screen.getByTestId('execute-error-policy-refused')).toBeTruthy());
  });

  it('offers retry only for an item that failed closed', async () => {
    api.listItems.mockResolvedValue({ items: [ITEM], total: 1 });
    api.getItem.mockResolvedValue(ITEM);
    wrap(<AutomationQueue />);
    await openItem();
    expect((screen.getByTestId('retry-item') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers reversal only for an item that actually executed, and only with a reason', async () => {
    api.listItems.mockResolvedValue({ items: [ITEM], total: 1 });
    api.getItem.mockResolvedValue({ ...ITEM, state: 'EXECUTED' });
    wrap(<AutomationQueue />);
    await openItem();
    expect((screen.getByTestId('reverse-item') as HTMLButtonElement).disabled).toBe(true);
    expect(api.reverseItem).not.toHaveBeenCalled();
  });

  it('presents a permission refusal as a refusal, not as an outage', async () => {
    api.listItems.mockRejectedValue(refusal(403, '403 Forbidden: permission_denied'));
    wrap(<AutomationQueue />);
    await waitFor(() => expect(screen.getByTestId('automation-queue-unauthorized')).toBeTruthy());
    expect(screen.queryByTestId('queue-table')).toBeNull();
  });

  it('presents a suspended capability as suspended rather than as empty', async () => {
    api.listItems.mockRejectedValue(refusal(409, 'CAPABILITY_SUSPENDED: circuit breaker tripped'));
    wrap(<AutomationQueue />);
    await waitFor(() => expect(screen.getByTestId('automation-queue-suspended')).toBeTruthy());
    expect(screen.queryByTestId('queue-empty')).toBeNull();
  });
});

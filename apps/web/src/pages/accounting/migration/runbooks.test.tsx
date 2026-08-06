/**
 * CE-16 S132(b) — Migration Runbooks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MigrationRunbooks from './runbooks';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

const INSTANCE = { id: 'rb-1', runId: 'run-a', legalEntityId: 'le-1', state: 'ACTIVE', createdAt: '2026-08-01T00:00:00.000Z' };

const DETAIL = {
  instance: INSTANCE,
  steps: [
    { code: 'D1', phase: 'DISCOVERY', title: 'Inventory the legacy source systems', status: 'COMPLETE', owner: 'op-1', evidenceRefs: ['ev-1'], gateLinkage: null },
    { code: 'R1', phase: 'REHEARSAL', title: 'Rehearse the conversion end to end', status: 'PENDING', owner: null, evidenceRefs: [], gateLinkage: 'G2' },
    { code: 'X1', phase: 'CUTOVER', title: 'Execute the cutover ceremony', status: 'PENDING', owner: null, evidenceRefs: [], gateLinkage: 'G5' },
  ],
  progress: { total: 3, complete: 1, blocked: 0, percent: 33 },
  satisfiedGates: ['G2'],
};

async function openInstance() {
  await waitFor(() => expect(screen.getByTestId('runbook-open-rb-1')).toBeTruthy());
  await userEvent.click(screen.getByTestId('runbook-open-rb-1'));
}

describe('MigrationRunbooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
    api.listRuns.mockResolvedValue({ items: [{ id: 'r1', runId: 'run-a' }], total: 1 });
    api.listRunbooks.mockResolvedValue({ items: [INSTANCE], total: 1 });
    api.listRunbookTemplates.mockResolvedValue({
      items: [{ id: 'std', name: 'Standard migration runbook', version: 1, steps: DETAIL.steps, builtIn: true }],
      total: 1,
    });
  });

  it('holds a loading state while instances are fetched', () => {
    api.listRunbooks.mockReturnValue(pending());
    wrap(<MigrationRunbooks />);
    expect(screen.getByText(/loading migration runbooks/i)).toBeTruthy();
  });

  it('states that no runbook instance exists yet', async () => {
    api.listRunbooks.mockResolvedValue({ items: [], total: 0 });
    wrap(<MigrationRunbooks />);
    await waitFor(() => expect(screen.getByTestId('runbooks-empty')).toBeTruthy());
  });

  it('will not create an instance without a run', async () => {
    wrap(<MigrationRunbooks />);
    await waitFor(() => expect(screen.getByTestId('create-runbook-btn')).toBeTruthy());
    expect((screen.getByTestId('create-runbook-btn') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(screen.getByTestId('runbook-run-select'), 'run-a');
    expect((screen.getByTestId('create-runbook-btn') as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByTestId('create-runbook-btn'));
    await waitFor(() => expect(api.createRunbook).toHaveBeenCalledWith({ runId: 'run-a', templateId: undefined }));
  });

  it('shows the progress the service computed, not a local count', async () => {
    api.getRunbook.mockResolvedValue(DETAIL);
    wrap(<MigrationRunbooks />);
    await openInstance();
    await waitFor(() => expect(screen.getByTestId('runbook-progress').textContent).toBe('1 / 3 (33%)'));
    expect(screen.getByTestId('runbook-blocked').textContent).toBe('0');
  });

  it('marks a gate-linked step according to the gates the service says are satisfied', async () => {
    api.getRunbook.mockResolvedValue(DETAIL);
    wrap(<MigrationRunbooks />);
    await openInstance();
    await waitFor(() => expect(screen.getByTestId('step-gate-R1')).toBeTruthy());
    expect(screen.getByTestId('runbook-satisfied-gates').textContent).toBe('G2');
    expect(screen.getByTestId('step-gate-R1').className).toMatch(/emerald/);
    expect(screen.getByTestId('step-gate-X1').className).toMatch(/amber/);
    expect(screen.getByTestId('runbook-gate-note').textContent).toMatch(/without an evidence reference/i);
  });

  it('reports that no gate is satisfied yet rather than showing an empty value', async () => {
    api.getRunbook.mockResolvedValue({ ...DETAIL, satisfiedGates: [] });
    wrap(<MigrationRunbooks />);
    await openInstance();
    await waitFor(() => expect(screen.getByTestId('runbook-satisfied-gates').textContent).toBe('None yet'));
  });

  it('sends the owner, status and evidence refs when a step is saved', async () => {
    api.getRunbook.mockResolvedValue(DETAIL);
    api.updateRunbookStep.mockResolvedValue({ code: 'R1', status: 'COMPLETE' });
    wrap(<MigrationRunbooks />);
    await openInstance();
    await waitFor(() => expect(screen.getByTestId('step-owner-R1')).toBeTruthy());
    await userEvent.type(screen.getByTestId('step-owner-R1'), 'controller-1');
    await userEvent.selectOptions(screen.getByTestId('step-status-R1'), 'COMPLETE');
    await userEvent.type(screen.getByTestId('step-evidence-R1'), 'ev-9, ev-10');
    await userEvent.click(screen.getByTestId('step-save-R1'));
    await waitFor(() => expect(api.updateRunbookStep).toHaveBeenCalledWith('rb-1', 'R1', {
      status: 'COMPLETE', owner: 'controller-1', evidenceRefs: ['ev-9', 'ev-10'], note: undefined,
    }));
  });

  it('surfaces a service refusal to complete a step whose gate is unsatisfied', async () => {
    api.getRunbook.mockResolvedValue(DETAIL);
    api.updateRunbookStep.mockRejectedValue(new Error('GATE_NOT_SATISFIED: G5 is not satisfied'));
    wrap(<MigrationRunbooks />);
    await openInstance();
    await waitFor(() => expect(screen.getByTestId('step-save-X1')).toBeTruthy());
    await userEvent.click(screen.getByTestId('step-save-X1'));
    await waitFor(() => expect(screen.getByTestId('step-update-error')).toBeTruthy());
    expect(screen.getByText(/G5 is not satisfied/)).toBeTruthy();
  });

  it('lists the built-in standard template', async () => {
    wrap(<MigrationRunbooks />);
    await waitFor(() => expect(screen.getByTestId('template-row-std')).toBeTruthy());
    expect(screen.getByTestId('template-row-std').textContent).toContain('BUILT-IN');
  });

  it('reports an API failure', async () => {
    api.listRunbooks.mockRejectedValue(new Error('runbook service down'));
    wrap(<MigrationRunbooks />);
    await waitFor(() => expect(screen.getByTestId('migration-runbooks-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.run.read', async () => {
    api.listRunbooks.mockRejectedValue(new Error('403 permission_denied'));
    wrap(<MigrationRunbooks />);
    await waitFor(() => expect(screen.getByTestId('migration-runbooks-unauthorized')).toBeTruthy());
  });
});

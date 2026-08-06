/**
 * CE-16 — Cutover Ceremony: readiness, SoD, irreversibility, idempotency,
 * and governed rollback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MigrationCutover from './cutover';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

const STATEMENT = 'Executing this cutover is irreversible. Legacy becomes read-only and conversion journals become authoritative.';

const CEREMONY = {
  runId: 'run-a', state: 'PREPARED', preparedBy: 'operator-1', preparedAt: new Date().toISOString(),
  approverIdentity: null, freezeTimestamp: new Date().toISOString(),
  rollbackBoundary: 'conversion journals only', targetEnvironment: 'PRODUCTION',
  irreversibleEffectStatement: STATEMENT,
};

async function selectRun() {
  await waitFor(() => expect(screen.getByTestId('cutover-run-select')).toBeTruthy());
  await userEvent.selectOptions(screen.getByTestId('cutover-run-select'), 'run-a');
}

describe('MigrationCutover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
    api.listRuns.mockResolvedValue({ items: [{ id: 'r1', runId: 'run-a', state: 'READY_FOR_CUTOVER' }], total: 1 });
    api.getReadiness.mockResolvedValue({ ready: true, unmet: [] });
    api.getCeremony.mockResolvedValue(null);
    api.getRestartPlan.mockResolvedValue({ restartable: true, resumeFromState: 'VALIDATED', completedPhases: ['DISCOVERED', 'MAPPED'] });
  });

  it('holds a loading state while runs are fetched', () => {
    api.listRuns.mockReturnValue(pending());
    wrap(<MigrationCutover />);
    expect(screen.getByText(/loading cutover ceremony/i)).toBeTruthy();
  });

  it('asks for a run before showing anything', async () => {
    wrap(<MigrationCutover />);
    await waitFor(() => expect(screen.getByTestId('cutover-no-run')).toBeTruthy());
  });

  it('lists unmet prerequisites and refuses to imply readiness', async () => {
    api.getReadiness.mockResolvedValue({
      ready: false,
      unmet: ['blockingExceptions: 2 blocking exceptions are still pending', 'freezeDeclared: no freeze attestation'],
    });
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('cutover-unmet')).toBeTruthy());
    expect(screen.getByTestId('cutover-readiness-badge').textContent).toContain('2 UNMET');
  });

  it('states that cutover is never triggered by a successful test', async () => {
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('cutover-no-autocut-note')).toBeTruthy());
    expect(screen.getByTestId('cutover-no-autocut-note').textContent).toMatch(/never triggered automatically/i);
  });

  it('states that no ceremony has been prepared yet', async () => {
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('ceremony-empty')).toBeTruthy());
  });

  it('displays the irreversible-effect statement and the preparer identity', async () => {
    api.getCeremony.mockResolvedValue(CEREMONY);
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('irreversible-statement')).toBeTruthy());
    expect(screen.getByTestId('irreversible-statement-text').textContent).toBe(STATEMENT);
    expect(screen.getByTestId('ceremony-prepared-by').textContent).toBe('operator-1');
    expect(screen.getByTestId('ceremony-approver').textContent).toBe('—');
    expect(screen.getByTestId('cutover-sod-note').textContent).toMatch(/preparer cannot grant final approval/i);
  });

  it('will not send an approval without an acknowledgement', async () => {
    api.getCeremony.mockResolvedValue(CEREMONY);
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('approve-cutover-btn')).toBeTruthy());
    expect((screen.getByTestId('approve-cutover-btn') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByTestId('copy-statement-btn'));
    await waitFor(() => expect((screen.getByTestId('approve-cutover-btn') as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByTestId('approve-cutover-btn'));
    await waitFor(() => expect(api.approveCutover).toHaveBeenCalledWith('run-a', { acknowledgedStatement: STATEMENT }));
  });

  it('surfaces a segregation-of-duties refusal from the service', async () => {
    api.getCeremony.mockResolvedValue(CEREMONY);
    api.approveCutover.mockRejectedValue(new Error('SOD_VIOLATION: the preparer cannot approve their own cutover'));
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('copy-statement-btn')).toBeTruthy());
    await userEvent.click(screen.getByTestId('copy-statement-btn'));
    await userEvent.click(screen.getByTestId('approve-cutover-btn'));
    await waitFor(() => expect(screen.getByTestId('approve-error')).toBeTruthy());
    expect(screen.getByText(/preparer cannot approve their own cutover/i)).toBeTruthy();
  });

  it('reports a repeated execution as an idempotent replay, not a new cutover', async () => {
    api.getCeremony.mockResolvedValue({ ...CEREMONY, state: 'COMPLETE' });
    api.executeCutover.mockResolvedValue({
      state: 'COMPLETE', idempotentReplay: true, runState: 'CUTOVER_COMPLETE', ceremony: {},
    });
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('execute-cutover-btn')).toBeTruthy());
    await userEvent.click(screen.getByTestId('execute-cutover-btn'));
    await waitFor(() => expect(screen.getByTestId('idempotent-banner')).toBeTruthy());
    expect(screen.getByTestId('execute-idempotent').textContent).toBe('YES');
    expect(screen.getByTestId('execute-result-state').textContent).toBe('COMPLETE');
  });

  it('presents a financial rollback as governed reversals with evidence preserved', async () => {
    api.getCeremony.mockResolvedValue({ ...CEREMONY, state: 'COMPLETE' });
    api.rollback.mockResolvedValue({
      plan: { kind: 'PROMOTED_FINANCIAL_REVERSAL', rationale: 'promoted journals must be reversed, not deleted' },
      reversals: [{ originalJournalRef: 'jrn-1', status: 'POSTED', reversalJournalRef: 'jrn-1-rev', postingExecutionRef: 'pex-2' }],
      evidencePreserved: true,
    });
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('rollback-reason-input')).toBeTruthy());
    await userEvent.type(screen.getByTestId('rollback-reason-input'), 'conversion balances restated after review');
    await userEvent.click(screen.getByTestId('rollback-btn'));
    await waitFor(() => expect(screen.getByTestId('rollback-result')).toBeTruthy());
    expect(screen.getByTestId('rollback-result-kind').textContent).toBe('PROMOTED_FINANCIAL_REVERSAL');
    expect(screen.getByTestId('rollback-reversal-count').textContent).toBe('1');
    expect(screen.getByTestId('rollback-evidence-preserved').textContent).toBe('YES');
    expect(screen.getByTestId('reversal-row-0').textContent).toContain('jrn-1-rev');
  });

  it('shows the restart plan the service computed', async () => {
    wrap(<MigrationCutover />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('restart-plan')).toBeTruthy());
    expect(screen.getByTestId('restart-restartable').textContent).toBe('YES');
    expect(screen.getByTestId('restart-resume-from').textContent).toBe('VALIDATED');
    expect(screen.getByTestId('restart-completed-phases').textContent).toContain('DISCOVERED');
  });

  it('shows an unauthorized state when the caller lacks migration.cutover.prepare', async () => {
    api.listRuns.mockRejectedValue(new Error('403 permission_denied'));
    wrap(<MigrationCutover />);
    await waitFor(() => expect(screen.getByTestId('migration-cutover-unauthorized')).toBeTruthy());
  });
});

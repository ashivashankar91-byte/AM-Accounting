/**
 * CE-16 S129 gate G5 — Exception Queue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MigrationExceptions from './exceptions';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

async function selectRun() {
  await waitFor(() => expect(screen.getByTestId('exceptions-run-select')).toBeTruthy());
  await userEvent.selectOptions(screen.getByTestId('exceptions-run-select'), 'run-a');
}

describe('MigrationExceptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
    api.listRuns.mockResolvedValue({ items: [{ id: 'r1', runId: 'run-a' }], total: 1 });
    api.listExceptions.mockResolvedValue({ items: [], total: 0, blockingPending: 0, g5Satisfiable: true });
  });

  it('holds a loading state while runs are fetched', () => {
    api.listRuns.mockReturnValue(pending());
    wrap(<MigrationExceptions />);
    expect(screen.getByText(/loading exception queue/i)).toBeTruthy();
  });

  it('asks for a run before showing anything', async () => {
    wrap(<MigrationExceptions />);
    await waitFor(() => expect(screen.getByTestId('exceptions-no-run')).toBeTruthy());
  });

  it('confirms G5 is satisfiable when the queue is clear', async () => {
    wrap(<MigrationExceptions />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('exceptions-g5').textContent).toBe('YES'));
    expect(screen.getByTestId('exceptions-empty')).toBeTruthy();
  });

  it('blocks G5 while blocking exceptions are still pending', async () => {
    api.listExceptions.mockResolvedValue({
      items: [{
        id: 'x1', exceptionType: 'AMBIGUOUS', sourceField: 'accountCode', sourceValue: '????',
        reason: 'legacy account meaning is ambiguous', disposition: 'PENDING',
      }],
      total: 1, blockingPending: 1, g5Satisfiable: false,
    });
    wrap(<MigrationExceptions />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('exceptions-g5-blocked')).toBeTruthy());
    expect(screen.getByTestId('exceptions-g5').textContent).toBe('NO');
    expect(screen.getByTestId('exceptions-blocking-pending').textContent).toBe('1');
    expect(screen.getByTestId('exception-disposition-x1').textContent).toBe('PENDING');
  });

  it('will not submit a disposition without a stated reason', async () => {
    api.listExceptions.mockResolvedValue({
      items: [{ id: 'x1', exceptionType: 'UNMAPPED', sourceValue: '9999', reason: 'no mapping', disposition: 'PENDING' }],
      total: 1, blockingPending: 1, g5Satisfiable: false,
    });
    wrap(<MigrationExceptions />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('exception-submit-x1')).toBeTruthy());
    expect((screen.getByTestId('exception-submit-x1') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByTestId('exception-reason-x1'), 'mapped to suspense pending review');
    expect((screen.getByTestId('exception-submit-x1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the disposition and its reason to the service', async () => {
    api.listExceptions.mockResolvedValue({
      items: [{ id: 'x1', exceptionType: 'UNMAPPED', sourceValue: '9999', reason: 'no mapping', disposition: 'PENDING' }],
      total: 1, blockingPending: 1, g5Satisfiable: false,
    });
    api.dispositionException.mockResolvedValue({ id: 'x1', disposition: 'APPROVED' });
    wrap(<MigrationExceptions />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('exception-reason-x1')).toBeTruthy());
    await userEvent.type(screen.getByTestId('exception-reason-x1'), 'confirmed against the legacy ledger');
    await userEvent.click(screen.getByTestId('exception-submit-x1'));
    await waitFor(() => expect(api.dispositionException).toHaveBeenCalledWith(
      'run-a', 'x1', { disposition: 'APPROVED', reason: 'confirmed against the legacy ledger' },
    ));
  });

  it('reports an API failure', async () => {
    api.listExceptions.mockRejectedValue(new Error('exception service down'));
    wrap(<MigrationExceptions />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('exceptions-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.exception.view', async () => {
    api.listRuns.mockRejectedValue(new Error('403 permission_denied'));
    wrap(<MigrationExceptions />);
    await waitFor(() => expect(screen.getByTestId('migration-exceptions-unauthorized')).toBeTruthy());
  });
});

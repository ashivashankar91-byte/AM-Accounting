/**
 * CE-16 S129/S130 — Reconciliation & Lineage drill.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MigrationReconcile from './reconcile';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

async function selectRun() {
  await waitFor(() => expect(screen.getByTestId('reconcile-run-select')).toBeTruthy());
  await userEvent.selectOptions(screen.getByTestId('reconcile-run-select'), 'run-a');
}

describe('MigrationReconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
    api.listRuns.mockResolvedValue({ items: [{ id: 'r1', runId: 'run-a' }], total: 1 });
  });

  it('holds a loading state while runs are fetched', () => {
    api.listRuns.mockReturnValue(pending());
    wrap(<MigrationReconcile />);
    expect(screen.getByText(/loading reconciliation & lineage/i)).toBeTruthy();
  });

  it('asks for a run before showing anything', async () => {
    wrap(<MigrationReconcile />);
    await waitFor(() => expect(screen.getByTestId('reconcile-no-run')).toBeTruthy());
  });

  it('states the G2 subledger conservation result', async () => {
    api.listGates.mockResolvedValue({
      items: [{ id: 'g2', gateCode: 'G2', result: 'PASS', details: { stagedTotal: '1500.00', controlBalance: '1500.00' } }],
      total: 1,
    });
    wrap(<MigrationReconcile />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('reconcile-g2').textContent).toBe('PASS'));
    expect(screen.getByTestId('reconcile-g2-detail').textContent).toContain('1500.00');
  });

  it('formats control totals it is given without recomputing them', async () => {
    api.listControlTotals.mockResolvedValue({
      items: [{
        id: 'ct-1', phase: 'STAGING', rowCount: 4, acceptedCount: 4, rejectedCount: 0,
        totalDebit: '2500.75', totalCredit: '2500.75', openItemTotal: '0', scheduleBalance: '0',
        capturedAt: new Date().toISOString(),
      }],
      total: 1,
    });
    wrap(<MigrationReconcile />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('reconcile-total-ct-1')).toBeTruthy());
    expect(screen.getByTestId('reconcile-total-ct-1').textContent).toContain('2,500.75');
  });

  it('shows the whole drill path from source row to journal', async () => {
    api.listLineage.mockResolvedValue({
      items: [{
        id: 'ln-1', sourceSystemRef: 'src-1', sourceFileRef: 'file-1', sourceRowRef: 'row-1',
        stagingRecordId: 'stg-1', transformationVersion: 'ce16.v1:ms-1:1',
        targetRecordId: 'jrn-1', targetRecordType: 'JOURNAL_ENTRY', journalRef: 'jrn-1',
        postingExecutionRef: 'pex-1', mappingDecisionRef: 'ms-1:accountCode:1000',
        openItemRef: null, reconciliationRef: null, evidence: { family: 'CONVERSION' },
      }],
      total: 1,
    });
    wrap(<MigrationReconcile />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('lineage-row-ln-1')).toBeTruthy());
    expect(screen.getByTestId('lineage-journal-ln-1').textContent).toBe('jrn-1');
    await userEvent.click(screen.getByTestId('lineage-expand-ln-1'));
    const detail = screen.getByTestId('lineage-detail-ln-1');
    expect(detail.textContent).toContain('pex-1');
    expect(detail.textContent).toContain('ms-1:accountCode:1000');
  });

  it('marks a staged-but-unpromoted row honestly', async () => {
    api.listLineage.mockResolvedValue({
      items: [{
        id: 'ln-2', sourceSystemRef: 'src-1', sourceRowRef: 'row-2', stagingRecordId: 'stg-2',
        transformationVersion: 'ce16.v1:ms-1:1', targetRecordId: null, journalRef: null,
      }],
      total: 1,
    });
    wrap(<MigrationReconcile />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('lineage-row-ln-2').textContent).toContain('Not promoted'));
  });

  it('reports a lineage API failure', async () => {
    api.listLineage.mockRejectedValue(new Error('lineage unavailable'));
    wrap(<MigrationReconcile />);
    await selectRun();
    await waitFor(() => expect(screen.getByTestId('lineage-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.reconcile.view', async () => {
    api.listRuns.mockRejectedValue(new Error('403 forbidden'));
    wrap(<MigrationReconcile />);
    await waitFor(() => expect(screen.getByTestId('migration-reconcile-unauthorized')).toBeTruthy());
  });
});

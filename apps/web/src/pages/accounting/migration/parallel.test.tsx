/**
 * CE-16 S131 — Parallel-Run Comparison Harness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MigrationParallel from './parallel';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

const COMPARISON = {
  id: 'cmp-1', periodYear: 2026, periodMonth: 1, state: 'COMPLETE',
  totalDiffs: 2, unexplainedDiffs: 1, signedOffBy: null, signedOffAt: null,
};

async function openComparison() {
  await waitFor(() => expect(screen.getByTestId('parallel-run-select')).toBeTruthy());
  await userEvent.selectOptions(screen.getByTestId('parallel-run-select'), 'run-a');
  await waitFor(() => expect(screen.getByTestId('comparison-open-cmp-1')).toBeTruthy());
  await userEvent.click(screen.getByTestId('comparison-open-cmp-1'));
}

describe('MigrationParallel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
    api.listRuns.mockResolvedValue({ items: [{ id: 'r1', runId: 'run-a' }], total: 1 });
    api.listComparisons.mockResolvedValue({ items: [COMPARISON], total: 1 });
  });

  it('holds a loading state while runs are fetched', () => {
    api.listRuns.mockReturnValue(pending());
    wrap(<MigrationParallel />);
    expect(screen.getByText(/loading parallel run comparison/i)).toBeTruthy();
  });

  it('asks for a run before showing anything', async () => {
    wrap(<MigrationParallel />);
    await waitFor(() => expect(screen.getByTestId('parallel-no-run')).toBeTruthy());
  });

  it('states the exit criterion as explanation, not absence of differences', async () => {
    api.getComparison.mockResolvedValue({
      comparison: COMPARISON,
      diffs: [],
      summary: {
        totalDiffs: 2, explainedDiffs: 1, unexplainedDiffs: 1, exitCriterionMet: false,
        byClassification: { TIMING: 1, MAPPING: 0, LEGACY_ERROR: 0, MODERN_ERROR: 0, UNEXPLAINED: 1 },
      },
    });
    wrap(<MigrationParallel />);
    await openComparison();
    await waitFor(() => expect(screen.getByTestId('exit-criterion-blocked')).toBeTruthy());
    expect(screen.getByTestId('summary-total').textContent).toBe('2');
    expect(screen.getByTestId('summary-explained').textContent).toBe('1');
    expect(screen.getByTestId('summary-unexplained').textContent).toBe('1');
    expect(screen.getByTestId('summary-exit-criterion').textContent).toBe('NO');
    expect(screen.getByTestId('exit-criterion-blocked').textContent).toMatch(/not that there are no\s+differences/i);
  });

  it('accepts a period whose differences are all explained', async () => {
    api.getComparison.mockResolvedValue({
      comparison: { ...COMPARISON, unexplainedDiffs: 0 },
      diffs: [],
      summary: {
        totalDiffs: 3, explainedDiffs: 3, unexplainedDiffs: 0, exitCriterionMet: true,
        byClassification: { TIMING: 2, MAPPING: 1, LEGACY_ERROR: 0, MODERN_ERROR: 0, UNEXPLAINED: 0 },
      },
    });
    wrap(<MigrationParallel />);
    await openComparison();
    await waitFor(() => expect(screen.getByTestId('summary-exit-criterion').textContent).toBe('YES'));
    expect(screen.queryByTestId('exit-criterion-blocked')).toBeNull();
  });

  it('formats each difference and its variance', async () => {
    api.getComparison.mockResolvedValue({
      comparison: COMPARISON,
      diffs: [{
        id: 'd1', diffType: 'TB_ACCOUNT', dimension: '1000', sourceValue: '1000.00',
        targetValue: '1010.50', variance: '-10.50', classification: 'UNEXPLAINED', disposition: 'PENDING', reason: null,
      }],
      summary: { totalDiffs: 1, explainedDiffs: 0, unexplainedDiffs: 1, exitCriterionMet: false, byClassification: {} },
    });
    wrap(<MigrationParallel />);
    await openComparison();
    await waitFor(() => expect(screen.getByTestId('diff-row-d1')).toBeTruthy());
    expect(screen.getByTestId('diff-variance-d1').textContent).toBe('-10.50');
    expect(screen.getByTestId('diff-classification-d1').textContent).toBe('UNEXPLAINED');
    expect(screen.getByTestId('diff-disposition-d1').textContent).toBe('PENDING');
  });

  it('will not classify a difference without an explanation', async () => {
    api.getComparison.mockResolvedValue({
      comparison: COMPARISON,
      diffs: [{ id: 'd1', diffType: 'TB_ACCOUNT', dimension: '1000', sourceValue: '1', targetValue: '2', variance: '-1', classification: 'UNEXPLAINED', disposition: 'PENDING' }],
      summary: { totalDiffs: 1, explainedDiffs: 0, unexplainedDiffs: 1, exitCriterionMet: false, byClassification: {} },
    });
    wrap(<MigrationParallel />);
    await openComparison();
    await waitFor(() => expect(screen.getByTestId('diff-classify-d1')).toBeTruthy());
    expect((screen.getByTestId('diff-classify-d1') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByTestId('diff-reason-d1'), 'legacy posted the accrual in the prior period');
    expect((screen.getByTestId('diff-classify-d1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the classification and explanation to the service', async () => {
    api.getComparison.mockResolvedValue({
      comparison: COMPARISON,
      diffs: [{ id: 'd1', diffType: 'TB_ACCOUNT', dimension: '1000', sourceValue: '1', targetValue: '2', variance: '-1', classification: 'UNEXPLAINED', disposition: 'PENDING' }],
      summary: { totalDiffs: 1, explainedDiffs: 0, unexplainedDiffs: 1, exitCriterionMet: false, byClassification: {} },
    });
    api.classifyDiff.mockResolvedValue({ diff: {}, summary: {} });
    wrap(<MigrationParallel />);
    await openComparison();
    await waitFor(() => expect(screen.getByTestId('diff-reason-d1')).toBeTruthy());
    await userEvent.selectOptions(screen.getByTestId('diff-classify-select-d1'), 'TIMING');
    await userEvent.type(screen.getByTestId('diff-reason-d1'), 'timing difference at the period boundary');
    await userEvent.click(screen.getByTestId('diff-classify-d1'));
    await waitFor(() => expect(api.classifyDiff).toHaveBeenCalledWith('run-a', 'd1', {
      classification: 'TIMING',
      reason: 'timing difference at the period boundary',
      comparisonRunId: 'cmp-1',
    }));
  });

  it('states the operator/signer segregation of duties', async () => {
    api.getComparison.mockResolvedValue({
      comparison: COMPARISON, diffs: [],
      summary: { totalDiffs: 0, explainedDiffs: 0, unexplainedDiffs: 0, exitCriterionMet: true, byClassification: {} },
    });
    wrap(<MigrationParallel />);
    await openComparison();
    await waitFor(() => expect(screen.getByTestId('parallel-sod-note')).toBeTruthy());
    expect(screen.getByTestId('parallel-sod-note').textContent).toMatch(/cannot be the controller/i);
  });

  it('reports an API failure', async () => {
    api.listComparisons.mockRejectedValue(new Error('comparison service down'));
    wrap(<MigrationParallel />);
    await waitFor(() => expect(screen.getByTestId('parallel-run-select')).toBeTruthy());
    await userEvent.selectOptions(screen.getByTestId('parallel-run-select'), 'run-a');
    await waitFor(() => expect(screen.getByTestId('comparisons-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.reconcile.view', async () => {
    api.listRuns.mockRejectedValue(new Error('403 permission_denied'));
    wrap(<MigrationParallel />);
    await waitFor(() => expect(screen.getByTestId('migration-parallel-unauthorized')).toBeTruthy());
  });
});

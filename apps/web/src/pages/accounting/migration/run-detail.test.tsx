/**
 * CE-16 S129/S130 — Migration Run Detail: readiness, gates, control totals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MigrationRunDetail from './run-detail';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

/** The detail screen reads its run id from the route, so it needs a real path. */
function renderAtRun(runId = 'run-a') {
  return render(
    <MemoryRouter initialEntries={[`/accounting/migration/runs/${runId}`]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Routes>
          <Route path="/accounting/migration/runs/:runId" element={<MigrationRunDetail />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const RUN = {
  runId: 'run-a', legalEntityId: 'le-1', mode: 'REHEARSAL', state: 'VALIDATED',
  transformationVersion: 'ce16.v1', frozenAt: null,
};

describe('MigrationRunDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
  });

  it('holds a loading state while the run is fetched', () => {
    api.getRun.mockReturnValue(pending());
    renderAtRun();
    expect(screen.getByText(/loading migration run/i)).toBeTruthy();
  });

  it('renders the run and its pinned transformation version', async () => {
    api.getRun.mockResolvedValue({ run: RUN, readiness: { ready: false, unmet: [] }, datasets: [] });
    renderAtRun();
    await waitFor(() => expect(screen.getByTestId('run-id').textContent).toBe('run-a'));
    expect(screen.getByTestId('run-state').textContent).toBe('VALIDATED');
    expect(screen.getByTestId('run-version').textContent).toBe('ce16.v1');
    expect(screen.getByTestId('run-frozen').textContent).toBe('Not attested');
  });

  it('states every unmet cutover prerequisite', async () => {
    api.getRun.mockResolvedValue({
      run: RUN,
      readiness: {
        ready: false,
        unmet: ['allGatesPassed: gates have not all passed', 'freezeDeclared: no freeze attestation'],
        ce15Detail: 'CE-15 readiness not approved for 2026-01',
      },
      datasets: [],
    });
    renderAtRun();
    await waitFor(() => expect(screen.getByTestId('readiness-unmet')).toBeTruthy());
    expect(screen.getByTestId('readiness-verdict').textContent).toContain('2 prerequisite');
    expect(screen.getByTestId('readiness-allGatesPassed').textContent).toContain('UNMET');
    expect(screen.getByTestId('ce15-detail').textContent).toContain('CE-15 readiness not approved');
  });

  it('confirms readiness when every prerequisite is met', async () => {
    api.getRun.mockResolvedValue({ run: RUN, readiness: { ready: true, unmet: [] }, datasets: [] });
    renderAtRun();
    await waitFor(() => expect(screen.getByTestId('readiness-verdict').textContent).toContain('prerequisites met'));
    expect(screen.queryByTestId('readiness-unmet')).toBeNull();
  });

  it('formats staged dataset totals without recomputing them', async () => {
    api.getRun.mockResolvedValue({
      run: RUN,
      readiness: { ready: false, unmet: [] },
      datasets: [{
        id: 'ds-1', datasetType: 'TB', state: 'VALIDATED', rowCount: 4, acceptedCount: 4,
        rejectedCount: 0, skippedCount: 0, totalDebit: '1500.5', totalCredit: '1500.5', controlChecksum: 'abcdef0123456789',
      }],
    });
    renderAtRun();
    await waitFor(() => expect(screen.getByTestId('dataset-row-ds-1')).toBeTruthy());
    expect(screen.getByTestId('dataset-row-ds-1').textContent).toContain('1,500.50');
  });

  it('renders gate results including a failure', async () => {
    api.getRun.mockResolvedValue({ run: RUN, readiness: { ready: false, unmet: [] }, datasets: [] });
    api.listGates.mockResolvedValue({
      items: [
        { id: 'g1', gateCode: 'G1', result: 'PASS', details: {}, evaluatedAt: new Date().toISOString() },
        { id: 'g2', gateCode: 'G2', result: 'FAIL', details: { variance: '10.00' }, evaluatedAt: new Date().toISOString() },
      ],
      total: 2,
    });
    renderAtRun();
    await waitFor(() => expect(screen.getByTestId('gate-result-G2').textContent).toBe('FAIL'));
    expect(screen.getByTestId('gate-result-G1').textContent).toBe('PASS');
  });

  it('reports an API failure instead of a half-rendered run', async () => {
    api.getRun.mockRejectedValue(new Error('run not found'));
    renderAtRun();
    await waitFor(() => expect(screen.getByTestId('migration-run-detail-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.run.read', async () => {
    api.getRun.mockRejectedValue(new Error('403 permission_denied'));
    renderAtRun();
    await waitFor(() => expect(screen.getByTestId('migration-run-detail-unauthorized')).toBeTruthy());
  });
});

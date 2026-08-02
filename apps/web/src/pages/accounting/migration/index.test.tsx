/**
 * CE-16 S129/S130/S131/S132 — Migration Command Center.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import MigrationCommandCenter from './index';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

describe('MigrationCommandCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
  });

  it('holds a loading state while runs are being fetched', () => {
    api.listRuns.mockReturnValue(pending());
    wrap(<MigrationCommandCenter />);
    expect(screen.getByText(/loading accounting migration/i)).toBeTruthy();
  });

  it('states plainly that no runs exist rather than showing an empty grid', async () => {
    api.listRuns.mockResolvedValue({ items: [], total: 0 });
    wrap(<MigrationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('runs-empty')).toBeTruthy());
    expect(screen.getByTestId('lifecycle-empty')).toBeTruthy();
  });

  it('lists runs with their lifecycle state', async () => {
    api.listRuns.mockResolvedValue({
      items: [
        { id: '1', runId: 'run-a', legalEntityId: 'le-1', mode: 'REHEARSAL', state: 'STAGED', transformationVersion: 'v1' },
        { id: '2', runId: 'run-b', legalEntityId: 'le-1', mode: 'CUTOVER', state: 'READY_FOR_CUTOVER', transformationVersion: 'v1' },
      ],
      total: 2,
    });
    wrap(<MigrationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('run-row-run-a')).toBeTruthy());
    expect(screen.getByTestId('run-state-run-a').textContent).toBe('STAGED');
    expect(screen.getByTestId('run-state-run-b').textContent).toBe('READY_FOR_CUTOVER');
  });

  it('summarises the lifecycle by state', async () => {
    api.listRuns.mockResolvedValue({
      items: [
        { id: '1', runId: 'a', state: 'STAGED', mode: 'REHEARSAL', legalEntityId: 'le-1' },
        { id: '2', runId: 'b', state: 'STAGED', mode: 'REHEARSAL', legalEntityId: 'le-1' },
      ],
      total: 2,
    });
    wrap(<MigrationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('lifecycle-badges').textContent).toContain('STAGED: 2'));
  });

  it('reports an API failure instead of rendering stale content', async () => {
    api.listRuns.mockRejectedValue(new Error('migration-service unreachable'));
    wrap(<MigrationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('migration-command-center-error')).toBeTruthy());
    expect(screen.getByText(/migration-service unreachable/i)).toBeTruthy();
  });

  it('shows an unauthorized state rather than an error when the caller lacks permission', async () => {
    api.listRuns.mockRejectedValue(new Error('403 permission_denied: migration.run.read'));
    wrap(<MigrationCommandCenter />);
    await waitFor(() => expect(screen.getByTestId('migration-command-center-unauthorized')).toBeTruthy());
    expect(screen.getByText(/migration\.run\.read/)).toBeTruthy();
  });
});

/**
 * CE-16 S130 — Migration Sources: inventory, extracts, row inspection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import MigrationSources from './sources';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

describe('MigrationSources', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
    api.listSources.mockResolvedValue({ items: [], total: 0, configured: false, upstreamSignals: [] });
  });

  it('holds a loading state while the source inventory is fetched', () => {
    api.listSources.mockReturnValue(pending());
    wrap(<MigrationSources />);
    expect(screen.getByText(/loading migration sources/i)).toBeTruthy();
  });

  it('reports SOURCE_NOT_CONFIGURED rather than showing a healthy empty grid', async () => {
    wrap(<MigrationSources />);
    await waitFor(() => expect(screen.getByTestId('sources-not-configured')).toBeTruthy());
    expect(screen.getByText(/SOURCE_NOT_CONFIGURED/)).toBeTruthy();
  });

  it('lists registered source systems', async () => {
    api.listSources.mockResolvedValue({
      items: [{ id: 's1', systemCode: 'LEGACY-DMS', systemName: 'Legacy DMS', sourceType: 'AUTOMATE', connectionStatus: 'CONFIGURED' }],
      total: 1,
      configured: true,
      upstreamSignals: [],
    });
    wrap(<MigrationSources />);
    await waitFor(() => expect(screen.getByTestId('source-row-LEGACY-DMS')).toBeTruthy());
    expect(screen.getByText('Legacy DMS')).toBeTruthy();
  });

  it('states which upstream modules are pending technical reconciliation', async () => {
    api.listSources.mockResolvedValue({
      items: [{ id: 's1', systemCode: 'L', systemName: 'L', sourceType: 'AUTOMATE', connectionStatus: 'CONFIGURED' }],
      total: 1,
      configured: true,
      upstreamSignals: [
        { moduleCode: 'CE-09', status: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION', detail: 'AP/AR targets pending' },
        { moduleCode: 'CE-13', status: 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION', detail: 'Payroll targets pending' },
      ],
    });
    wrap(<MigrationSources />);
    await waitFor(() => expect(screen.getByTestId('sources-upstream-pending')).toBeTruthy());
    const banner = screen.getByTestId('sources-upstream-pending');
    expect(banner.textContent).toContain('CE-09');
    expect(banner.textContent).toContain('CE-13');
    expect(banner.textContent).toContain('nothing has been marked migrated');
  });

  it('reports an API failure', async () => {
    api.listSources.mockRejectedValue(new Error('migration-service unreachable'));
    wrap(<MigrationSources />);
    await waitFor(() => expect(screen.getByTestId('migration-sources-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.source.view', async () => {
    api.listSources.mockRejectedValue(new Error('403 forbidden'));
    wrap(<MigrationSources />);
    await waitFor(() => expect(screen.getByTestId('migration-sources-unauthorized')).toBeTruthy());
  });
});

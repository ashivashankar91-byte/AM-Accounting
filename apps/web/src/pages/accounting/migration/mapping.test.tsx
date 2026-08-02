/**
 * CE-16 S130 — COA Mapping Workbench: coverage meter and version freeze.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MigrationMapping from './mapping';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

const SET = { id: 'ms-1', version: 2, status: 'DRAFT', sourceSystemId: 'src-1' };

describe('MigrationMapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
    api.listSources.mockResolvedValue({ items: [], total: 0, configured: true, upstreamSignals: [] });
  });

  it('holds a loading state while mapping sets are fetched', () => {
    api.listMappingSets.mockReturnValue(pending());
    wrap(<MigrationMapping />);
    expect(screen.getByText(/loading coa mapping workbench/i)).toBeTruthy();
  });

  it('states that no mapping sets exist', async () => {
    wrap(<MigrationMapping />);
    await waitFor(() => expect(screen.getByTestId('mapping-sets-empty')).toBeTruthy());
  });

  it('shows incomplete coverage as blocking, with the manual-review count', async () => {
    api.listMappingSets.mockResolvedValue({ items: [SET], total: 1 });
    api.getMappingSet.mockResolvedValue({
      set: SET,
      items: [
        { id: 'e1', sourceField: 'accountCode', sourceValue: '1000', classification: 'ALIGN', status: 'MAPPED', targetValue: '1000' },
        { id: 'e2', sourceField: 'accountCode', sourceValue: '9999', classification: null, status: 'MANUAL_REVIEW_REQUIRED' },
      ],
      coverage: { totalEntries: 2, disposedEntries: 1, manualReviewRequired: 1, coveragePercent: 50, complete: false, byClassification: {} },
    });
    wrap(<MigrationMapping />);
    await waitFor(() => expect(screen.getByTestId('mapping-set-open-ms-1')).toBeTruthy());
    await userEvent.click(screen.getByTestId('mapping-set-open-ms-1'));
    await waitFor(() => expect(screen.getByTestId('coverage-percent').textContent).toContain('50'));
    expect(screen.getByTestId('coverage-manual-review').textContent).toBe('1');
    expect(screen.getByTestId('coverage-incomplete')).toBeTruthy();
    expect(screen.getByTestId('mapping-status-e2').textContent).toBe('MANUAL_REVIEW_REQUIRED');
  });

  it('presents a frozen mapping set as immutable', async () => {
    const frozen = { ...SET, status: 'FROZEN', frozenBy: 'controller-1', frozenAt: new Date().toISOString() };
    api.listMappingSets.mockResolvedValue({ items: [frozen], total: 1 });
    api.getMappingSet.mockResolvedValue({
      set: frozen,
      items: [{ id: 'e1', sourceField: 'accountCode', sourceValue: '1000', classification: 'ALIGN', status: 'MAPPED', targetValue: '1000' }],
      coverage: { totalEntries: 1, disposedEntries: 1, manualReviewRequired: 0, coveragePercent: 100, complete: true, byClassification: {} },
    });
    wrap(<MigrationMapping />);
    await waitFor(() => expect(screen.getByTestId('mapping-set-open-ms-1')).toBeTruthy());
    await userEvent.click(screen.getByTestId('mapping-set-open-ms-1'));
    await waitFor(() => expect(screen.getByTestId('mapping-frozen-banner')).toBeTruthy());
    expect((screen.getByTestId('freeze-mapping-btn') as HTMLButtonElement).disabled).toBe(true);
    // A frozen set exposes no editable classification control.
    expect(screen.queryByTestId('mapping-classification-e1')).toBeNull();
  });

  it('states that decision and approval are separate acts', async () => {
    api.listMappingSets.mockResolvedValue({ items: [SET], total: 1 });
    api.getMappingSet.mockResolvedValue({
      set: SET,
      items: [{ id: 'e1', sourceField: 'accountCode', sourceValue: '1000', classification: 'ALIGN', status: 'MAPPED', decidedBy: 'operator-1' }],
      coverage: { totalEntries: 1, disposedEntries: 1, manualReviewRequired: 0, coveragePercent: 100, complete: true, byClassification: {} },
    });
    wrap(<MigrationMapping />);
    await waitFor(() => expect(screen.getByTestId('mapping-set-open-ms-1')).toBeTruthy());
    await userEvent.click(screen.getByTestId('mapping-set-open-ms-1'));
    await waitFor(() => expect(screen.getByTestId('mapping-sod-note')).toBeTruthy());
    expect(screen.getByTestId('mapping-sod-note').textContent).toMatch(/cannot approve it/i);
  });

  it('reports an API failure', async () => {
    api.listMappingSets.mockRejectedValue(new Error('mapping service down'));
    wrap(<MigrationMapping />);
    await waitFor(() => expect(screen.getByTestId('migration-mapping-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.mapping.view', async () => {
    api.listMappingSets.mockRejectedValue(new Error('401 unauthorized'));
    wrap(<MigrationMapping />);
    await waitFor(() => expect(screen.getByTestId('migration-mapping-unauthorized')).toBeTruthy());
  });
});

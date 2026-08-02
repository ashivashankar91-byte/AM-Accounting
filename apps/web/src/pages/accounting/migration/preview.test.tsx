/**
 * CE-16 S130 — Transformation Preview: determinism and honest exceptions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MigrationPreview from './preview';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

async function requestPreview() {
  await waitFor(() => expect(screen.getByTestId('preview-run-select')).toBeTruthy());
  await userEvent.selectOptions(screen.getByTestId('preview-run-select'), 'run-a');
  await userEvent.type(screen.getByTestId('preview-snapshot-input'), 'snap-1');
  await userEvent.selectOptions(screen.getByTestId('preview-mapping-select'), 'ms-1');
  await userEvent.click(screen.getByTestId('preview-run-btn'));
}

describe('MigrationPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
    api.listRuns.mockResolvedValue({ items: [{ id: 'r1', runId: 'run-a' }], total: 1 });
    api.listMappingSets.mockResolvedValue({ items: [{ id: 'ms-1', version: 1, status: 'FROZEN' }], total: 1 });
  });

  it('holds a loading state while runs are fetched', () => {
    api.listRuns.mockReturnValue(pending());
    wrap(<MigrationPreview />);
    expect(screen.getByText(/loading transformation preview/i)).toBeTruthy();
  });

  it('asks for inputs before it claims anything', async () => {
    wrap(<MigrationPreview />);
    await waitFor(() => expect(screen.getByTestId('preview-empty')).toBeTruthy());
    expect(screen.getByTestId('preview-readonly-note').textContent).toMatch(/never writes to staging/i);
  });

  it('reports the pinned transformation version and the row split', async () => {
    api.preview.mockResolvedValue({
      transformationVersion: 'ce16.v1:ms-1:1',
      mappingSetStatus: 'FROZEN',
      previewedRows: 3,
      transformedCount: 2,
      exceptionCount: 1,
      rows: [{ sourceRowId: 'sr-1', rowHash: 'abc123', stagedData: { accountCode: '1000' }, validationErrors: [] }],
      exceptions: [{ exceptionType: 'UNMAPPED', sourceField: 'accountCode', sourceValue: '9999', reason: 'no mapping decision' }],
    });
    wrap(<MigrationPreview />);
    await requestPreview();
    await waitFor(() => expect(screen.getByTestId('preview-version').textContent).toBe('ce16.v1:ms-1:1'));
    expect(screen.getByTestId('preview-rows-read').textContent).toBe('3');
    expect(screen.getByTestId('preview-transformed').textContent).toBe('2');
    expect(screen.getByTestId('preview-exceptions-count').textContent).toBe('1');
    expect(screen.getByTestId('preview-exception-0').textContent).toContain('UNMAPPED');
  });

  it('warns that a draft mapping set cannot be used for staging', async () => {
    api.preview.mockResolvedValue({
      transformationVersion: 'ce16.v1:ms-1:1',
      mappingSetStatus: 'DRAFT',
      previewedRows: 1, transformedCount: 1, exceptionCount: 0, rows: [], exceptions: [],
    });
    wrap(<MigrationPreview />);
    await requestPreview();
    await waitFor(() => expect(screen.getByTestId('preview-not-frozen')).toBeTruthy());
  });

  it('reports a preview failure', async () => {
    api.preview.mockRejectedValue(new Error('mapping set not found'));
    wrap(<MigrationPreview />);
    await requestPreview();
    await waitFor(() => expect(screen.getByTestId('preview-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.staging.read', async () => {
    api.listRuns.mockRejectedValue(new Error('403 forbidden'));
    wrap(<MigrationPreview />);
    await waitFor(() => expect(screen.getByTestId('migration-preview-unauthorized')).toBeTruthy());
  });
});

/**
 * CE-16 S132(a) — Legacy Statement Archive.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MigrationArchive from './archive';
import { migrationApi } from '../../../api/client';
import { resolveAllEmpty, pending, wrap } from './test-helpers';

vi.mock('../../../api/client', async () => (await import('./test-helpers')).migrationApiMockModule());

const api = migrationApi as any;

const STATEMENT = {
  id: 'a1', periodYear: 2025, periodMonth: 12, statementType: 'BALANCE_SHEET',
  legalEntityId: 'le-1', sourceSystem: 'LEGACY', filename: '2025-12-balance-sheet.pdf',
  fileSize: 2048, checksumSha256: 'abcdef0123456789abcdef0123456789',
  wormClass: 'FINANCIAL_STATEMENT_7Y', retentionUntil: '2032-12-31T00:00:00.000Z', accessCount: 3,
};

describe('MigrationArchive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAllEmpty(api);
  });

  it('holds a loading state while the archive is fetched', () => {
    api.listArchive.mockReturnValue(pending());
    wrap(<MigrationArchive />);
    expect(screen.getByText(/loading legacy statement archive/i)).toBeTruthy();
  });

  it('states that nothing has been archived yet', async () => {
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('archive-empty')).toBeTruthy());
  });

  it('always states that an archived statement is immutable', async () => {
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('archive-immutable-note')).toBeTruthy());
    expect(screen.getByTestId('archive-immutable-note').textContent).toMatch(/never edited or replaced/i);
  });

  it('shows the index metadata, checksum and WORM class of an archived statement', async () => {
    api.listArchive.mockResolvedValue({ items: [STATEMENT], total: 1 });
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('archive-row-a1')).toBeTruthy());
    const row = screen.getByTestId('archive-row-a1');
    expect(row.textContent).toContain('2025-12');
    expect(row.textContent).toContain('BALANCE_SHEET');
    expect(row.textContent).toContain('2025-12-balance-sheet.pdf');
    expect(row.textContent).toContain('abcdef0123456789');
    expect(screen.getByTestId('archive-worm-a1').textContent).toBe('FINANCIAL_STATEMENT_7Y');
    expect(screen.getByTestId('archive-access-count-a1').textContent).toBe('3');
  });

  it('will not import without a filename', async () => {
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('archive-import-btn')).toBeTruthy());
    expect((screen.getByTestId('archive-import-btn') as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByTestId('archive-filename-input'), '2025-12-income.pdf');
    expect((screen.getByTestId('archive-import-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the index metadata with the imported file', async () => {
    api.importArchive.mockResolvedValue({ id: 'a2' });
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('archive-filename-input')).toBeTruthy());
    await userEvent.type(screen.getByTestId('archive-filename-input'), '2025-12-income.pdf');
    await userEvent.selectOptions(screen.getByTestId('archive-type-input'), 'INCOME_STATEMENT');
    await userEvent.click(screen.getByTestId('archive-import-btn'));
    await waitFor(() => expect(api.importArchive).toHaveBeenCalled());
    const body = api.importArchive.mock.calls[0][0];
    expect(body.filename).toBe('2025-12-income.pdf');
    expect(body.statementType).toBe('INCOME_STATEMENT');
    expect(body.periodMonth).toBe(12);
    expect(typeof body.contentBase64).toBe('string');
    expect(body.contentBase64.length).toBeGreaterThan(0);
  });

  it('records a view as an access rather than a mutation', async () => {
    api.listArchive.mockResolvedValue({ items: [STATEMENT], total: 1 });
    api.recordArchiveAccess.mockResolvedValue({ accessCount: 4 });
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('archive-view-a1')).toBeTruthy());
    await userEvent.click(screen.getByTestId('archive-view-a1'));
    await waitFor(() => expect(api.recordArchiveAccess).toHaveBeenCalledWith('a1'));
  });

  it('passes the search filters to the service instead of filtering locally', async () => {
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('archive-year-filter')).toBeTruthy());
    fireEvent.change(screen.getByTestId('archive-year-filter'), { target: { value: '2025' } });
    await userEvent.selectOptions(screen.getByTestId('archive-type-filter'), 'TRIAL_BALANCE');
    await waitFor(() => {
      expect(api.listArchive.mock.calls.some(
        ([q]: any[]) => q?.periodYear === 2025 && q?.statementType === 'TRIAL_BALANCE',
      )).toBe(true);
    });
  });

  it('reports an API failure', async () => {
    api.listArchive.mockRejectedValue(new Error('archive service down'));
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('migration-archive-error')).toBeTruthy());
  });

  it('shows an unauthorized state when the caller lacks migration.audit.view', async () => {
    api.listArchive.mockRejectedValue(new Error('403 permission_denied'));
    wrap(<MigrationArchive />);
    await waitFor(() => expect(screen.getByTestId('migration-archive-unauthorized')).toBeTruthy());
  });
});

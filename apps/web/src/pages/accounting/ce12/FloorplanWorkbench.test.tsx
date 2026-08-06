/**
 * CE-12 gap-closure — FloorplanWorkbench component tests. Covers the Staged
 * Rows tab (loading/empty/error), and the new journal drill-down link on a
 * posted VIN match row (GET /api/v1/coa/journals/:number via
 * goldenPathApi.getJournal).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FloorplanWorkbench from './FloorplanWorkbench';
import { floorplanApi } from '../../../api/ce12-vehicle-floorplan-client';
import { goldenPathApi } from '../../../api/client';

vi.mock('../../../api/ce12-vehicle-floorplan-client', () => ({
  floorplanApi: {
    listLenders: vi.fn(),
    getFeedStatus: vi.fn(),
    listStagedRows: vi.fn(),
    listMatches: vi.fn(),
    matchStagedRow: vi.fn(),
    listBreaks: vi.fn(),
    getTieOut: vi.fn(),
  },
}));

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<any>('../../../api/client');
  return {
    ...actual,
    goldenPathApi: { ...actual.goldenPathApi, getJournal: vi.fn() },
  };
});

function renderPage() {
  (floorplanApi.listLenders as any).mockResolvedValue({ items: [] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FloorplanWorkbench />
    </QueryClientProvider>,
  );
}

describe('FloorplanWorkbench — Staged Rows tab', () => {
  it('renders staged rows from the real API response', async () => {
    (floorplanApi.listStagedRows as any).mockResolvedValue({
      items: [{ id: 'row-1', lenderCode: 'ALLY', rowType: 'FEED', vin: '1FAKE0000000FP001', amount: '21000.00', statementDate: '2026-07-01', sourceType: 'FIXTURE_FEED', status: 'STAGED' }],
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('staged-rows-tab-button'));

    await waitFor(() => expect(floorplanApi.listStagedRows).toHaveBeenCalled());
    expect(await screen.findByTestId('staged-row-row-1')).toBeInTheDocument();
  });

  it('shows the empty state when there are no staged rows', async () => {
    (floorplanApi.listStagedRows as any).mockResolvedValue({ items: [] });
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('staged-rows-tab-button'));
    expect(await screen.findByTestId('staged-rows-empty-state')).toBeInTheDocument();
  });
});

describe('FloorplanWorkbench — VIN Match journal drill-down', () => {
  it('drills into the real coa-service journal from a posted match row', async () => {
    (floorplanApi.listStagedRows as any).mockResolvedValue({ items: [] });
    (floorplanApi.listMatches as any).mockResolvedValue({
      items: [{ id: 'match-1', matchType: 'AUTO_VIN', status: 'POSTED', journalNumber: 'JE-300001', matchedBy: 'solera-acct@solera.demo', matchedAt: '2026-07-01T00:00:00Z' }],
    });
    (goldenPathApi.getJournal as any).mockResolvedValue({ status: 'POSTED', entryDate: '2026-07-01', memo: 'Floorplan liability relief', lines: [] });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('vin-match-tab-button'));
    await user.click(await screen.findByTestId('journal-drill-link-match-1'));

    await waitFor(() => expect(goldenPathApi.getJournal).toHaveBeenCalledWith('JE-300001'));
    expect(await screen.findByTestId('ce12-journal-drill-drawer')).toBeInTheDocument();
  });
});

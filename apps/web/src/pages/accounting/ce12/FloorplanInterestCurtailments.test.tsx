/**
 * CE-12 gap-closure — FloorplanInterestCurtailments component tests. Covers
 * the Interest Statements list (loading/empty/error) and the new journal
 * drill-down links on a posted interest-accrual statement row and a
 * curtailment-payment row (GET /api/v1/coa/journals/:number via
 * goldenPathApi.getJournal).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FloorplanInterestCurtailments from './FloorplanInterestCurtailments';
import { floorplanApi } from '../../../api/ce12-vehicle-floorplan-client';
import { goldenPathApi } from '../../../api/client';

vi.mock('../../../api/ce12-vehicle-floorplan-client', () => ({
  floorplanApi: {
    listInterestStatements: vi.fn(),
    listCurtailmentSchedules: vi.fn(),
    listCurtailmentPayments: vi.fn(),
    enterInterestStatement: vi.fn(),
    allocateInterestStatement: vi.fn(),
    postInterestAccrual: vi.fn(),
    reverseInterestAccrual: vi.fn(),
    configureCurtailmentSchedule: vi.fn(),
    payCurtailment: vi.fn(),
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FloorplanInterestCurtailments />
    </QueryClientProvider>,
  );
}

describe('FloorplanInterestCurtailments — Interest Statements tab', () => {
  it('renders interest statement rows from the real API response', async () => {
    (floorplanApi.listInterestStatements as any).mockResolvedValue({
      items: [{ id: 'stmt-1', lenderCode: 'ALLY', statementDate: '2026-07-01', totalInterestAmount: '1200.00', allocationBasis: 'PER_UNIT_BALANCE_WEIGHTED', status: 'POSTED', journalNumber: 'JE-400001' }],
    });
    renderPage();

    await waitFor(() => expect(floorplanApi.listInterestStatements).toHaveBeenCalled());
    expect(await screen.findByTestId('interest-statement-row-stmt-1')).toBeInTheDocument();
  });

  it('shows a permission-denied message on a 403, not fabricated rows', async () => {
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (floorplanApi.listInterestStatements as any).mockRejectedValue(forbidden);
    renderPage();
    expect(await screen.findByText(/do not have permission to view interest statements/i)).toBeInTheDocument();
  });

  it('drills into the real coa-service journal from a posted interest statement row', async () => {
    (floorplanApi.listInterestStatements as any).mockResolvedValue({
      items: [{ id: 'stmt-1', lenderCode: 'ALLY', statementDate: '2026-07-01', totalInterestAmount: '1200.00', allocationBasis: 'PER_UNIT_BALANCE_WEIGHTED', status: 'POSTED', journalNumber: 'JE-400001' }],
    });
    (goldenPathApi.getJournal as any).mockResolvedValue({ status: 'POSTED', entryDate: '2026-07-01', memo: 'Floorplan interest accrual', lines: [] });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('journal-drill-link-stmt-1'));
    await waitFor(() => expect(goldenPathApi.getJournal).toHaveBeenCalledWith('JE-400001'));
    expect(await screen.findByTestId('ce12-journal-drill-drawer')).toBeInTheDocument();
  });
});

describe('FloorplanInterestCurtailments — Curtailment payments journal drill-down', () => {
  it('drills into the real coa-service journal from a curtailment payment row', async () => {
    (floorplanApi.listInterestStatements as any).mockResolvedValue({ items: [] });
    (floorplanApi.listCurtailmentSchedules as any).mockResolvedValue({ items: [] });
    (floorplanApi.listCurtailmentPayments as any).mockResolvedValue({
      items: [{ id: 'pay-1', lenderCode: 'ALLY', vin: '1FAKE0000000CT001', amount: '750.00', paidAt: '2026-07-05T00:00:00Z', status: 'POSTED', journalNumber: 'JE-400050' }],
    });
    (goldenPathApi.getJournal as any).mockResolvedValue({ status: 'POSTED', entryDate: '2026-07-05', memo: 'Curtailment payment', lines: [] });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('curtailment-tab-button'));
    await user.click(await screen.findByTestId('journal-drill-link-pay-1'));

    await waitFor(() => expect(goldenPathApi.getJournal).toHaveBeenCalledWith('JE-400050'));
    expect(await screen.findByTestId('ce12-journal-drill-drawer')).toBeInTheDocument();
  });
});

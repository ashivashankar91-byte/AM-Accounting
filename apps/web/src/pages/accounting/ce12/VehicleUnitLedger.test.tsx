/**
 * CE-12 gap-closure — VehicleUnitLedger component tests. Covers the Units
 * list (loading/empty/error/unauthorized), the unit detail cost-buildup
 * lineage, and the new journal drill-down link (GET /api/v1/coa/journals/
 * :number via goldenPathApi.getJournal) on both a cost-component row and a
 * demo-value-adjustment row.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VehicleUnitLedger from './VehicleUnitLedger';
import { vehicleAccountingApi } from '../../../api/ce12-vehicle-floorplan-client';
import { goldenPathApi } from '../../../api/client';

vi.mock('../../../api/ce12-vehicle-floorplan-client', () => ({
  vehicleAccountingApi: {
    listUnits: vi.fn(),
    getUnit: vi.fn(),
    listDemoValueAdjustments: vi.fn(),
    listLcnrvWriteDowns: vi.fn(),
    getLcnrvWorklist: vi.fn(),
    listDealerTrades: vi.fn(),
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
      <VehicleUnitLedger />
    </QueryClientProvider>,
  );
}

const UNIT_ROW = {
  id: 'unit-1', stockNumber: 'STK-1001', vin: '1FAKE0000000UNIT1', status: 'NEW',
  acquisitionType: 'PURCHASE', bookValue: '21500.00', createdAt: '2026-07-01T00:00:00Z',
};

const UNIT_DETAIL = {
  unit: { ...UNIT_ROW, entityId: 'entity-kunes-delavan', storeId: 'STORE-1', disposedAt: null, disposalType: null },
  tieOut: { tiesOut: true, componentSumCents: 2150000 },
  costComponents: [
    { id: 'cc-1', componentType: 'TRANSPORT', amount: '500.00', description: 'Inbound transport', journalNumber: 'JE-200001', createdAt: '2026-07-01T00:00:00Z' },
  ],
};

describe('VehicleUnitLedger — Units tab', () => {
  it('renders unit rows from the real GET /units response', async () => {
    (vehicleAccountingApi.listUnits as any).mockResolvedValue({ items: [UNIT_ROW] });
    renderPage();

    await waitFor(() => expect(vehicleAccountingApi.listUnits).toHaveBeenCalled());
    expect(await screen.findByTestId('unit-row-STK-1001')).toBeInTheDocument();
  });

  it('shows the empty state when no units are stocked in', async () => {
    (vehicleAccountingApi.listUnits as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('units-empty-state')).toBeInTheDocument();
  });

  it('shows a permission-denied message on a 403, not fabricated rows', async () => {
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (vehicleAccountingApi.listUnits as any).mockRejectedValue(forbidden);
    renderPage();
    expect(await screen.findByTestId('units-error-banner')).toHaveTextContent('permission');
  });

  it('opens the unit detail panel and drills into the real coa-service journal from a cost-component row', async () => {
    (vehicleAccountingApi.listUnits as any).mockResolvedValue({ items: [UNIT_ROW] });
    (vehicleAccountingApi.getUnit as any).mockResolvedValue(UNIT_DETAIL);
    (goldenPathApi.getJournal as any).mockResolvedValue({
      status: 'POSTED', entryDate: '2026-07-01', memo: 'Transport cost component', source: '88',
      lines: [{ id: 'l1', accountNumber: '13000', debit: '500.00', credit: null }, { id: 'l2', accountNumber: '20100', debit: null, credit: '500.00' }],
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('unit-row-STK-1001'));
    await screen.findByTestId('unit-detail-STK-1001');
    expect(screen.getByTestId('unit-tie-strip')).toHaveTextContent('Ties out');

    await user.click(screen.getByTestId('journal-drill-link-cc-1'));
    await waitFor(() => expect(goldenPathApi.getJournal).toHaveBeenCalledWith('JE-200001'));
    expect(await screen.findByTestId('ce12-journal-drill-drawer')).toBeInTheDocument();
  });
});

describe('VehicleUnitLedger — Demo Adjustments tab journal drill-down', () => {
  it('drills into the real coa-service journal from a posted demo value adjustment', async () => {
    (vehicleAccountingApi.listUnits as any).mockResolvedValue({ items: [] });
    (vehicleAccountingApi.listDemoValueAdjustments as any).mockResolvedValue({
      items: [{ id: 'dva-1', unitId: 'unit-1', proposedAmount: '400.00', approvedAmount: '400.00', status: 'POSTED', journalNumber: 'JE-200050' }],
    });
    (goldenPathApi.getJournal as any).mockResolvedValue({ status: 'POSTED', entryDate: '2026-07-05', memo: 'Demo value adjustment', lines: [] });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('demo-adjustments-tab-button'));
    await user.click(await screen.findByTestId('journal-drill-link-dva-1'));

    await waitFor(() => expect(goldenPathApi.getJournal).toHaveBeenCalledWith('JE-200050'));
    expect(await screen.findByTestId('ce12-journal-drill-drawer')).toBeInTheDocument();
  });
});

/**
 * CE-12 — SotMonitor component tests. Read-only composition dashboard
 * (S081): aging tiles, tile-driven drill-down filtering, and the real
 * floorplanApi.getSotDashboard()/getSotAging() responses. Mirrors the
 * WholesaleArbitration.test.tsx / ScheduleOpenItems.test.tsx pattern.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SotMonitor from './SotMonitor';
import { floorplanApi } from '../../../api/ce12-vehicle-floorplan-client';

vi.mock('../../../api/ce12-vehicle-floorplan-client', () => ({
  floorplanApi: {
    getSotDashboard: vi.fn(),
    getSotAging: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SotMonitor />
    </QueryClientProvider>,
  );
}

const DASHBOARD = { tenantId: 't1', tiles: { WATCH: 2, ESCALATED: 1, RESOLVED: 3 }, totalDelivered: 6 };
const AGING_ROW_WATCH = {
  sotExceptionId: 'sot-1', applyNumber: 'AP-1', vin: '1FAKE00000000WT01', stockNumber: 'STK-1',
  exposureSince: '2026-07-01T00:00:00Z', exposureDays: 12, remainingBalance: '18500.00', escalationState: 'WATCH',
};
const AGING_ROW_ESCALATED = {
  sotExceptionId: 'sot-2', applyNumber: 'AP-2', vin: '1FAKE00000000ES02', stockNumber: 'STK-2',
  exposureSince: '2026-06-15T00:00:00Z', exposureDays: 28, remainingBalance: '22000.00', escalationState: 'ESCALATED',
};

describe('SotMonitor — read-only composition dashboard', () => {
  it('renders aging rows and tile totals from the real dashboard/aging responses', async () => {
    (floorplanApi.getSotDashboard as any).mockResolvedValue(DASHBOARD);
    (floorplanApi.getSotAging as any).mockResolvedValue({ items: [AGING_ROW_WATCH, AGING_ROW_ESCALATED] });
    renderPage();

    await waitFor(() => expect(floorplanApi.getSotDashboard).toHaveBeenCalled());
    expect(await screen.findByTestId('sot-aging-row-AP-1')).toBeInTheDocument();
    expect(screen.getByTestId('sot-aging-row-AP-2')).toBeInTheDocument();
    expect(screen.getByTestId('sot-tile-all')).toHaveTextContent('6');
    expect(screen.getByTestId('sot-tile-watch')).toHaveTextContent('2');
    expect(screen.getByTestId('sot-tile-escalated')).toHaveTextContent('1');
  });

  it('filters rows to the clicked escalation-state tile', async () => {
    (floorplanApi.getSotDashboard as any).mockResolvedValue(DASHBOARD);
    (floorplanApi.getSotAging as any).mockResolvedValue({ items: [AGING_ROW_WATCH, AGING_ROW_ESCALATED] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('sot-aging-row-AP-1');
    await user.click(screen.getByTestId('sot-tile-escalated'));

    expect(screen.queryByTestId('sot-aging-row-AP-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('sot-aging-row-AP-2')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is exposed past the grace period', async () => {
    (floorplanApi.getSotDashboard as any).mockResolvedValue({ tenantId: 't1', tiles: { WATCH: 0, ESCALATED: 0, RESOLVED: 0 }, totalDelivered: 0 });
    (floorplanApi.getSotAging as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('sot-empty-state')).toBeInTheDocument();
  });

  it('shows a permission-denied message on a 403 from either query, not a crash', async () => {
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (floorplanApi.getSotDashboard as any).mockRejectedValue(forbidden);
    (floorplanApi.getSotAging as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('sot-error-banner')).toHaveTextContent('permission');
  });

  it('surfaces a generic API error message when the failure is not a 403', async () => {
    (floorplanApi.getSotDashboard as any).mockResolvedValue(DASHBOARD);
    (floorplanApi.getSotAging as any).mockRejectedValue(new Error('SOT aging service unavailable'));
    renderPage();
    expect(await screen.findByTestId('sot-error-banner')).toHaveTextContent('SOT aging service unavailable');
  });
});

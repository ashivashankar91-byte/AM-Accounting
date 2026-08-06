/**
 * AMACC S048 — WholesaleVehicleTitleRelease smoke tests.
 * Security-critical: 409 refusal banner must appear; exception path must
 * require a mandatory reason and be visually distinct.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WholesaleVehicleTitleRelease from './WholesaleVehicleTitleRelease';
import { wholesaleVehicleApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  wholesaleVehicleApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    recordPayment: vi.fn(),
    releaseTitle: vi.fn(),
    releaseTitleException: vi.fn(),
    getReleaseExceptions: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WholesaleVehicleTitleRelease />
    </QueryClientProvider>,
  );
}

const VEHICLE = {
  id: 'wv-1',
  customerId: 'cust-1',
  vehicleVin: '1HGBH41JXMN109186',
  saleAmount: '25000.00',
  amountPaid: '25000.00',
  titleStatus: 'PENDING',
  payments: [],
};

describe('WholesaleVehicleTitleRelease list', () => {
  it('shows loading state initially', () => {
    (wholesaleVehicleApi.list as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading Wholesale Vehicles/i)).toBeInTheDocument();
  });

  it('shows empty state when no vehicles exist', async () => {
    (wholesaleVehicleApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No wholesale vehicle items/i)).toBeInTheDocument());
  });

  it('shows error state with retry when list fails', async () => {
    (wholesaleVehicleApi.list as any).mockRejectedValue(new Error('service down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
  });

  it('renders vehicle rows', async () => {
    (wholesaleVehicleApi.list as any).mockResolvedValue([VEHICLE]);
    renderPage();
    await waitFor(() => expect(screen.getByText('1HGBH41JXMN109186')).toBeInTheDocument());
  });
});

describe('WholesaleVehicleTitleRelease detail — release title', () => {
  it('calls releaseTitle and shows success on 200', async () => {
    const user = userEvent.setup();
    (wholesaleVehicleApi.list as any).mockResolvedValue([VEHICLE]);
    (wholesaleVehicleApi.getById as any).mockResolvedValue(VEHICLE);
    (wholesaleVehicleApi.getReleaseExceptions as any).mockResolvedValue([]);
    (wholesaleVehicleApi.releaseTitle as any).mockResolvedValue({ id: 'wv-1', titleStatus: 'RELEASED' });
    renderPage();

    await waitFor(() => expect(screen.getByText('1HGBH41JXMN109186')).toBeInTheDocument());
    await user.click(screen.getByText('1HGBH41JXMN109186'));

    await waitFor(() => expect(screen.getByRole('button', { name: /Release Title/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Release Title/i }));

    await waitFor(() => expect(wholesaleVehicleApi.releaseTitle).toHaveBeenCalledWith('wv-1'));
    await waitFor(() => expect(screen.getByText(/Title released successfully/i)).toBeInTheDocument());
  });

  it('shows refusal banner on 409 TITLE_RELEASE_REFUSED_UNPAID', async () => {
    const user = userEvent.setup();
    (wholesaleVehicleApi.list as any).mockResolvedValue([VEHICLE]);
    (wholesaleVehicleApi.getById as any).mockResolvedValue({ ...VEHICLE, amountPaid: '10000.00' });
    (wholesaleVehicleApi.getReleaseExceptions as any).mockResolvedValue([]);
    const err: any = new Error('TITLE_RELEASE_REFUSED_UNPAID');
    err.status = 409;
    err.body = { error: 'TITLE_RELEASE_REFUSED_UNPAID', outstandingBalance: '15000.00' };
    (wholesaleVehicleApi.releaseTitle as any).mockRejectedValue(err);
    renderPage();

    await waitFor(() => expect(screen.getByText('1HGBH41JXMN109186')).toBeInTheDocument());
    await user.click(screen.getByText('1HGBH41JXMN109186'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Release Title/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Release Title/i }));

    await waitFor(() => expect(screen.getByText(/Title Release Refused — Item Not Paid in Full/i)).toBeInTheDocument());
    expect(screen.getByText(/Outstanding balance/i)).toBeInTheDocument();
  });

  it('exception dialog requires a reason before submission', async () => {
    const user = userEvent.setup();
    (wholesaleVehicleApi.list as any).mockResolvedValue([VEHICLE]);
    (wholesaleVehicleApi.getById as any).mockResolvedValue(VEHICLE);
    (wholesaleVehicleApi.getReleaseExceptions as any).mockResolvedValue([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('1HGBH41JXMN109186')).toBeInTheDocument());
    await user.click(screen.getByText('1HGBH41JXMN109186'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Release with Exception/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Release with Exception/i }));

    // Dialog should appear with confirm button disabled (no reason)
    await waitFor(() => expect(screen.getByRole('button', { name: /Confirm Exception Release/i })).toBeDisabled());
  });

  it('shows exception audit trail', async () => {
    (wholesaleVehicleApi.list as any).mockResolvedValue([VEHICLE]);
    (wholesaleVehicleApi.getById as any).mockResolvedValue(VEHICLE);
    (wholesaleVehicleApi.getReleaseExceptions as any).mockResolvedValue([
      { id: 'exc-1', actor: 'jsmith', reason: 'Customer pay agreement in writing', createdAt: '2026-07-15T10:00:00Z' },
    ]);
    renderPage();

    await waitFor(() => expect(screen.getByText('1HGBH41JXMN109186')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByText('1HGBH41JXMN109186'));
    await waitFor(() => expect(screen.getByText(/Released via EXCEPTION by jsmith/i)).toBeInTheDocument());
    expect(screen.getByText(/Customer pay agreement in writing/i)).toBeInTheDocument();
  });
});

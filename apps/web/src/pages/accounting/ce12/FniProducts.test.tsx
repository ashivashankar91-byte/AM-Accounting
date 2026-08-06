/**
 * CE-12 gap-closure — FniProducts component tests. Covers the new
 * POST /cancellations/preview dry-run step, the real deferral-bookings list
 * (GET /deferral-bookings), and the schedule-service-authoritative deferral
 * tie-out (scheduleTieOut) versus a locally-summed fallback.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FniProducts from './FniProducts';
import { fniReserveApi } from '../../../api/ce12-fni-client';

vi.mock('../../../api/ce12-fni-client', async () => {
  const actual = await vi.importActual<any>('../../../api/ce12-fni-client');
  return {
    ...actual,
    fniReserveApi: {
      listRemitRuns: vi.fn(),
      getRemitLiabilityTieOut: vi.fn(),
      executeRemitRun: vi.fn(),
      listReconciliations: vi.fn(),
      listCancellations: vi.fn(),
      previewCancellation: vi.fn(),
      processCancellation: vi.fn(),
      listDeferralModeConfigs: vi.fn(),
      getDeferralLiabilityTieOut: vi.fn(),
      listDeferralBookings: vi.fn(),
      listRecognitionRuns: vi.fn(),
      getDeferralMode: vi.fn(),
    },
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FniProducts />
    </QueryClientProvider>,
  );
}

describe('FniProducts — Cancellations preview-before-submit', () => {
  it('calls the real POST /cancellations/preview and gates Confirm & process behind it', async () => {
    (fniReserveApi.listRemitRuns as any).mockResolvedValue([]);
    (fniReserveApi.getRemitLiabilityTieOut as any).mockResolvedValue({ openItems: [], totalOpenAmount: '0.00' });
    (fniReserveApi.listCancellations as any).mockResolvedValue([]);
    (fniReserveApi.previewCancellation as any).mockResolvedValue({
      preview: true, quoteTotal: '1000.00', incomeReversalAmount: '600.00', remitAdjustmentAmount: '400.00', refundPayableAmount: '1000.00',
    });
    (fniReserveApi.processCancellation as any).mockResolvedValue({
      id: 'canc-1', dealNumber: 'D-2001', productCode: 'GAP', cancellationSource: 'CUSTOMER', refundBasis: 'PROVIDER_QUOTE',
      quoteTotal: '1000.00', incomeReversalAmount: '600.00', remitAdjustmentAmount: '400.00', refundPayableAmount: '1000.00',
      refundPayableLinkageStatus: 'PENDING', chargebackTriggered: false, chargebackDrawId: null, status: 'PROCESSED', createdBy: 'solera-acct@solera.demo', createdAt: '2026-07-01T00:00:00Z',
    });

    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('fni-products-tab-cancellations'));
    await user.click(screen.getByTestId('cancellations-new-btn'));

    await user.type(screen.getByTestId('cancellation-deal-input'), 'D-2001');
    await user.type(screen.getByTestId('cancellation-product-input'), 'GAP');
    await user.type(screen.getByTestId('cancellation-income-input'), '600.00');
    await user.type(screen.getByTestId('cancellation-remit-input'), '400.00');
    await user.type(screen.getByTestId('cancellation-refund-percent-input'), '100');
    await user.click(screen.getByTestId('cancellation-preview-btn'));

    await waitFor(() => expect(fniReserveApi.previewCancellation).toHaveBeenCalled());
    expect(fniReserveApi.processCancellation).not.toHaveBeenCalled();
    expect(await screen.findByTestId('cancellation-preview-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('cancellation-submit'));
    await waitFor(() => expect(fniReserveApi.processCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ dealNumber: 'D-2001', productCode: 'GAP' }),
    ));
  });

  it('surfaces the duplicate-cancellation (409) refusal verbatim from the preview call', async () => {
    (fniReserveApi.listRemitRuns as any).mockResolvedValue([]);
    (fniReserveApi.getRemitLiabilityTieOut as any).mockResolvedValue({ openItems: [], totalOpenAmount: '0.00' });
    (fniReserveApi.listCancellations as any).mockResolvedValue([]);
    (fniReserveApi.previewCancellation as any).mockResolvedValue({ preview: true, quoteTotal: '1000.00', incomeReversalAmount: '600.00', remitAdjustmentAmount: '400.00', refundPayableAmount: '1000.00' });
    const dup: any = new Error('This deal/product has already been cancelled.');
    dup.status = 409;
    (fniReserveApi.processCancellation as any).mockRejectedValue(dup);

    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByTestId('fni-products-tab-cancellations'));
    await user.click(screen.getByTestId('cancellations-new-btn'));
    await user.type(screen.getByTestId('cancellation-deal-input'), 'D-2001');
    await user.type(screen.getByTestId('cancellation-product-input'), 'GAP');
    await user.type(screen.getByTestId('cancellation-income-input'), '600.00');
    await user.type(screen.getByTestId('cancellation-remit-input'), '400.00');
    await user.type(screen.getByTestId('cancellation-refund-percent-input'), '100');
    await user.click(screen.getByTestId('cancellation-preview-btn'));
    await screen.findByTestId('cancellation-preview-panel');
    await user.click(screen.getByTestId('cancellation-submit'));

    expect(await screen.findByTestId('cancellation-duplicate-refusal')).toHaveTextContent('already been cancelled');
  });
});

describe('FniProducts — Deferral bookings + schedule-authoritative tie-out', () => {
  async function openDeferralTab() {
    (fniReserveApi.listRemitRuns as any).mockResolvedValue([]);
    (fniReserveApi.getRemitLiabilityTieOut as any).mockResolvedValue({ openItems: [], totalOpenAmount: '0.00' });
    (fniReserveApi.listCancellations as any).mockResolvedValue([]);
    (fniReserveApi.listDeferralModeConfigs as any).mockResolvedValue([]);
    (fniReserveApi.listRecognitionRuns as any).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('fni-products-tab-deferral'));
    return user;
  }

  it('renders real deferral booking rows from GET /deferral-bookings', async () => {
    (fniReserveApi.getDeferralLiabilityTieOut as any).mockResolvedValue({ totalDeferred: '5000.00', totalRecognized: '1000.00', totalUnearned: '4000.00', scheduleTieOut: null });
    (fniReserveApi.listDeferralBookings as any).mockResolvedValue([
      { id: 'db-1', dealNumber: 'D-3001', productCode: 'VSC', productType: 'VSC', originalAmount: '2500.00', recognizedAmount: '500.00', bookingDate: '2026-06-01', earningPatternType: 'STRAIGHT_LINE_MONTHS', earningPatternMonths: 60, controlNumber: 'DEF:D-3001:VSC', status: 'OPEN', createdBy: 'solera-acct@solera.demo', createdAt: '2026-06-01T00:00:00Z' },
    ]);
    await openDeferralTab();

    expect(await screen.findByTestId('deferral-booking-row-db-1')).toBeInTheDocument();
  });

  it('shows the real schedule-service-authoritative tie-out when a schedule mapping is configured', async () => {
    (fniReserveApi.getDeferralLiabilityTieOut as any).mockResolvedValue({
      totalDeferred: '5000.00', totalRecognized: '1000.00', totalUnearned: '4000.00',
      scheduleTieOut: { scheduleNumber: '96', openItemCount: 3, totalRemainingBalance: '4000.00', source: 'SCHEDULE_SERVICE' },
    });
    (fniReserveApi.listDeferralBookings as any).mockResolvedValue([]);
    await openDeferralTab();

    const banner = await screen.findByTestId('deferral-schedule-tieout');
    expect(banner).toHaveTextContent('96');
    expect(banner).toHaveTextContent('4,000.00');
  });

  it('discloses when no schedule mapping is configured instead of fabricating a tie-out', async () => {
    (fniReserveApi.getDeferralLiabilityTieOut as any).mockResolvedValue({ totalDeferred: '0.00', totalRecognized: '0.00', totalUnearned: '0.00', scheduleTieOut: null });
    (fniReserveApi.listDeferralBookings as any).mockResolvedValue([]);
    await openDeferralTab();

    expect(await screen.findByTestId('deferral-liability-tieout-banner')).toHaveTextContent('No DEFERRED_INCOME_LIABILITY schedule mapping configured');
    expect(screen.queryByTestId('deferral-schedule-tieout')).not.toBeInTheDocument();
  });

  it('shows the empty state when there are no deferral bookings', async () => {
    (fniReserveApi.getDeferralLiabilityTieOut as any).mockResolvedValue({ totalDeferred: '0.00', totalRecognized: '0.00', totalUnearned: '0.00', scheduleTieOut: null });
    (fniReserveApi.listDeferralBookings as any).mockResolvedValue([]);
    await openDeferralTab();

    expect(await screen.findByTestId('deferral-bookings-empty')).toBeInTheDocument();
  });
});

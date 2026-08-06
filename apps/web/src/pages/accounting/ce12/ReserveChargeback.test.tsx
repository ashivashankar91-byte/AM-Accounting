/**
 * CE-12 gap-closure — ReserveChargeback component tests. Covers the real
 * chargeback-reserve accrual/draw list endpoints (replacing the prior
 * aggregate-tie-out-only / session-local-list workarounds) and the new
 * POST /chargebacks/preview dry-run step before Confirm & Post.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReserveChargeback from './ReserveChargeback';
import { fniReserveApi } from '../../../api/ce12-fni-client';

vi.mock('../../../api/ce12-fni-client', async () => {
  const actual = await vi.importActual<any>('../../../api/ce12-fni-client');
  return {
    ...actual,
    fniReserveApi: {
      listLenderProgramConfigs: vi.fn(),
      createLenderProgramConfig: vi.fn(),
      getChargebackReserveTieOut: vi.fn(),
      listChargebackReserveAccruals: vi.fn(),
      listChargebackReserveDraws: vi.fn(),
      previewChargeback: vi.fn(),
      processChargebackNotice: vi.fn(),
      listRemittances: vi.fn(),
      processRemittance: vi.fn(),
      dispositionShortPay: vi.fn(),
    },
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReserveChargeback />
    </QueryClientProvider>,
  );
}

function stubAccrualsTabDefaults() {
  (fniReserveApi.listLenderProgramConfigs as any).mockResolvedValue([]);
  (fniReserveApi.getChargebackReserveTieOut as any).mockResolvedValue({ lines: [], totalAccrued: '0.00', totalDrawn: '0.00', totalRemainingBalance: '0.00' });
  (fniReserveApi.listChargebackReserveAccruals as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
}

describe('ReserveChargeback — Accruals tab (real persisted list)', () => {
  it('renders individual accrual rows from the real GET /chargeback-reserve/accruals endpoint', async () => {
    (fniReserveApi.listLenderProgramConfigs as any).mockResolvedValue([]);
    (fniReserveApi.getChargebackReserveTieOut as any).mockResolvedValue({ lines: [], totalAccrued: '0.00', totalDrawn: '0.00', totalRemainingBalance: '0.00' });
    (fniReserveApi.listChargebackReserveAccruals as any).mockResolvedValue({
      items: [{ id: 'acc-1', tenantId: 't1', dealNumber: 'D-1001', lenderProgramCode: 'ALLY', reserveIncomeAmount: '2000.00', accrualPercent: '5.00', accrualAmount: '100.00', controlNumber: 'CBR:ALLY:D-1001', postingExecutionId: 'x1', idempotencyKey: 'idem-1', createdBy: 'solera-acct@solera.demo', createdAt: '2026-07-01T00:00:00Z' }],
      total: 1, page: 1, pageSize: 50,
    });
    renderPage();

    await waitFor(() => expect(fniReserveApi.listChargebackReserveAccruals).toHaveBeenCalled());
    expect(await screen.findByTestId('reserve-accrual-detail-row-acc-1')).toBeInTheDocument();
  });

  it('shows the empty state when there are no individual accrual rows', async () => {
    stubAccrualsTabDefaults();
    renderPage();
    expect(await screen.findByTestId('reserve-accrual-rows-empty')).toBeInTheDocument();
  });
});

describe('ReserveChargeback — Chargeback Draws tab (real preview + persisted history)', () => {
  async function openDrawsTab() {
    stubAccrualsTabDefaults();
    (fniReserveApi.listChargebackReserveDraws as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('reserve-tab-draws'));
    return user;
  }

  it('calls the real POST /chargebacks/preview dry-run and shows the server-computed split before posting', async () => {
    (fniReserveApi.previewChargeback as any).mockResolvedValue({
      preview: true, controlNumber: 'CBR:ALLY:D-1001', chargebackAmount: '500.00',
      reserveBalanceBefore: '600.00', drawFromReserveAmount: '500.00', excessToExpenseAmount: '0.00', reserveBalanceAfter: '100.00',
    });
    const user = await openDrawsTab();

    await user.type(screen.getByTestId('chargeback-deal-input'), 'D-1001');
    await user.type(screen.getByTestId('chargeback-lender-input'), 'ALLY');
    await user.type(screen.getByTestId('chargeback-amount-input'), '500.00');
    await user.click(screen.getByTestId('chargeback-review-btn'));

    await waitFor(() => expect(fniReserveApi.previewChargeback).toHaveBeenCalled());
    expect(fniReserveApi.processChargebackNotice).not.toHaveBeenCalled();
    expect(await screen.findByTestId('chargeback-confirm-drawer')).toBeInTheDocument();

    await user.click(screen.getByTestId('chargeback-confirm-submit'));
    await waitFor(() => expect(fniReserveApi.processChargebackNotice).toHaveBeenCalledWith(
      expect.objectContaining({ dealNumber: 'D-1001', lenderProgramCode: 'ALLY', chargebackAmount: '500.00' }),
    ));
  });

  it('renders real, persisted draw history from GET /chargeback-reserve/draws', async () => {
    stubAccrualsTabDefaults();
    (fniReserveApi.listChargebackReserveDraws as any).mockResolvedValue({
      items: [{ id: 'draw-1', tenantId: 't1', dealNumber: 'D-1002', lenderProgramCode: 'ALLY', controlNumber: 'CBR:ALLY:D-1002', chargebackAmount: '300.00', drawFromReserveAmount: '300.00', excessToExpenseAmount: '0.00', reserveBalanceBefore: '500.00', sourceType: 'EARLY_PAYOFF', sourceCancellationId: null, postingExecutionId: 'x2', idempotencyKey: 'idem-2', createdBy: 'solera-acct@solera.demo', createdAt: '2026-07-02T00:00:00Z' }],
      total: 1, page: 1, pageSize: 50,
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByTestId('reserve-tab-draws'));

    expect(await screen.findByTestId('chargeback-draw-row-draw-1')).toBeInTheDocument();
  });

  it('shows the empty state when no chargeback draws have been recorded', async () => {
    const user = await openDrawsTab();
    void user;
    expect(await screen.findByTestId('chargeback-draws-empty')).toBeInTheDocument();
  });

  it('surfaces a permission-denied state on a 403 from the preview call', async () => {
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (fniReserveApi.previewChargeback as any).mockRejectedValue(forbidden);
    const user = await openDrawsTab();

    await user.type(screen.getByTestId('chargeback-deal-input'), 'D-1001');
    await user.type(screen.getByTestId('chargeback-lender-input'), 'ALLY');
    await user.type(screen.getByTestId('chargeback-amount-input'), '500.00');
    await user.click(screen.getByTestId('chargeback-review-btn'));

    expect(await screen.findByTestId('chargeback-error')).toHaveTextContent('Forbidden');
  });
});

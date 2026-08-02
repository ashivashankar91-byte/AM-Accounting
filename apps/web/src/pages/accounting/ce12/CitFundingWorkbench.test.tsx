/**
 * CE-12 gap-closure — CitFundingWorkbench component tests. Covers the new
 * Sold Not Funded tab (GET /cit/sold-not-funded) and Receipts tab
 * (GET /cit/funding-receipts), plus the Short-Fund Disposition tab now
 * reading the real tenant-wide pending list instead of session state.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CitFundingWorkbench from './CitFundingWorkbench';
import { ce12DealApi } from '../../../api/ce12-deal-client';

vi.mock('../../../api/ce12-deal-client', () => ({
  ce12DealApi: {
    getCitAging: vi.fn(),
    getSoldNotFunded: vi.fn(),
    listCitFundingReceipts: vi.fn(),
    recordCitFunding: vi.fn(),
    dispositionCitShortfall: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CitFundingWorkbench />
    </QueryClientProvider>,
  );
}

const SNF_ITEM = {
  id: 'oi-1', tenantId: 't1', dealId: 'deal-1', itemType: 'CIT' as const, itemNumber: 'CIT-1',
  productIndex: null, originalAmount: '20000.00', appliedAmount: '0.00', remainingBalance: '20000.00',
  status: 'OPEN' as const, openedByPostingRecordId: 'pr-1', createdAt: '2026-07-01T00:00:00Z', closedAt: null, ageDays: 12,
  deal: { id: 'deal-1', tenantId: 't1', dealNumber: 'D-2001', dealType: 'RETAIL' as const, vin: null, stockNumber: 'S-1', legalEntityId: 'e1', storeId: 'STORE-1', status: 'POSTED', currentRecapVersion: 1, finalizedByActor: null, fundedFlag: false, createdAt: '', updatedAt: '' },
};

const RECEIPT = {
  id: 'rcpt-1', tenantId: 't1', dealId: 'deal-1', amount: '18000.00', lenderRef: 'LEN-1', receivedAt: '2026-07-02T00:00:00Z',
  citOriginalAmount: '20000.00', shortfallAmount: '2000.00', status: 'SHORT_FUNDED_PENDING_DISPOSITION' as const,
  dispositionType: null, dispositionReason: null, dispositionedBy: null, dispositionedAt: null, feePostingRecordId: null,
  idempotencyKey: 'idem-1', createdAt: '2026-07-02T00:00:00Z', createdBy: 'solera-admin@solera.demo',
};

describe('CitFundingWorkbench — Sold Not Funded tab', () => {
  it('renders real sold-not-funded rows (not a locally recomputed figure)', async () => {
    (ce12DealApi.getCitAging as any).mockResolvedValue({ items: [] });
    (ce12DealApi.getSoldNotFunded as any).mockResolvedValue([SNF_ITEM]);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('cit-tab-snf'));
    expect(await screen.findByTestId('cit-snf-row-CIT-1')).toBeInTheDocument();
    expect(screen.getByText('D-2001')).toBeInTheDocument();
  });

  it('shows the empty state when nothing is sold-not-funded', async () => {
    (ce12DealApi.getCitAging as any).mockResolvedValue({ items: [] });
    (ce12DealApi.getSoldNotFunded as any).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('cit-tab-snf'));
    expect(await screen.findByTestId('cit-snf-empty')).toBeInTheDocument();
  });

  it('shows a 403-specific message on error', async () => {
    (ce12DealApi.getCitAging as any).mockResolvedValue({ items: [] });
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (ce12DealApi.getSoldNotFunded as any).mockRejectedValue(forbidden);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('cit-tab-snf'));
    expect(await screen.findByTestId('cit-snf-error')).toHaveTextContent('Not authorized');
  });
});

describe('CitFundingWorkbench — Receipts tab', () => {
  it('renders a real persisted receipts list, filterable by status', async () => {
    (ce12DealApi.getCitAging as any).mockResolvedValue({ items: [] });
    (ce12DealApi.listCitFundingReceipts as any).mockResolvedValue({ items: [RECEIPT], total: 1, page: 1, pageSize: 50 });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('cit-tab-receipts'));
    expect(await screen.findByTestId('cit-receipt-row-rcpt-1')).toBeInTheDocument();
    expect(screen.getByText('LEN-1')).toBeInTheDocument();
  });
});

describe('CitFundingWorkbench — Short-Fund Disposition tab', () => {
  it('lists short-funded receipts pending disposition from the real tenant-wide list', async () => {
    (ce12DealApi.getCitAging as any).mockResolvedValue({ items: [] });
    (ce12DealApi.listCitFundingReceipts as any).mockResolvedValue({ items: [RECEIPT], total: 1, page: 1, pageSize: 50 });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('cit-tab-shortfund'));
    expect(await screen.findByTestId('short-fund-row-rcpt-1')).toBeInTheDocument();
  });

  it('submits a disposition with the selected type and reason', async () => {
    (ce12DealApi.getCitAging as any).mockResolvedValue({ items: [] });
    (ce12DealApi.listCitFundingReceipts as any).mockResolvedValue({ items: [RECEIPT], total: 1, page: 1, pageSize: 50 });
    (ce12DealApi.dispositionCitShortfall as any).mockResolvedValue({ ...RECEIPT, status: 'SHORT_FUNDED_FEE_WITHHELD' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('cit-tab-shortfund'));
    await screen.findByTestId('short-fund-row-rcpt-1');
    await user.type(screen.getByTestId('disposition-reason-input-rcpt-1'), 'Short-fund fee per lender terms');
    await user.click(screen.getByTestId('disposition-submit-button-rcpt-1'));

    await waitFor(() => expect(ce12DealApi.dispositionCitShortfall).toHaveBeenCalledWith('rcpt-1', 'FEE_WITHHELD', 'Short-fund fee per lender terms'));
  });
});

describe('CitFundingWorkbench — Funding Match tab', () => {
  it('records a funding receipt with a real idempotency key', async () => {
    (ce12DealApi.getCitAging as any).mockResolvedValue({ items: [] });
    (ce12DealApi.recordCitFunding as any).mockResolvedValue(RECEIPT);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('cit-tab-match'));
    await user.type(screen.getByTestId('funding-match-deal-number'), 'D-2001');
    await user.type(screen.getByTestId('funding-match-amount'), '18000.00');
    await user.type(screen.getByTestId('funding-match-lender-ref'), 'LEN-1');
    await user.click(screen.getByTestId('funding-match-submit-button'));

    await waitFor(() => expect(ce12DealApi.recordCitFunding).toHaveBeenCalled());
    const call = (ce12DealApi.recordCitFunding as any).mock.calls[0][0];
    expect(typeof call.idempotencyKey).toBe('string');
    expect(await screen.findByTestId('funding-match-result')).toBeInTheDocument();
  });
});

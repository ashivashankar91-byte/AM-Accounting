/**
 * CE-12 gap-closure — WholesaleArbitration component tests. Covers the real
 * GET /wholesale/dispositions list (replacing the prior session-local-list
 * workaround) plus the title-gate refusal and lookup-by-ID paths.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WholesaleArbitration from './WholesaleArbitration';
import { dealAccountingApi } from '../../../api/ce12-fni-client';

vi.mock('../../../context/EntityScopeContext', () => ({
  useEntityScope: () => ({ entityId: 'entity-kunes-delavan', storeId: 'STORE-1' }),
}));

vi.mock('../../../api/ce12-fni-client', async () => {
  const actual = await vi.importActual<any>('../../../api/ce12-fni-client');
  return {
    ...actual,
    dealAccountingApi: {
      listWholesaleDispositions: vi.fn(),
      disposeWholesale: vi.fn(),
      getWholesaleDisposition: vi.fn(),
      arbitrationPriceAdjustment: vi.fn(),
      arbitrationUnitReturn: vi.fn(),
    },
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WholesaleArbitration />
    </QueryClientProvider>,
  );
}

const DISPOSITION = {
  id: 'wd-1', tenantId: 't1', dealId: 'deal-1', unitRef: '1FAKE0000000WHSL1',
  titleStatus: 'RELEASED', wholesaleAmount: '8000.00', unitReliefAmount: '7500.00',
  auctionFeesAmount: '150.00', dispositionOutcome: 'GAIN' as const, gainLossAmount: '350.00',
  status: 'POSTED' as const, postingRecordId: 'pr-1', idempotencyKey: 'idem-1', createdAt: '2026-07-01T00:00:00Z', createdBy: 'solera-admin@solera.demo',
};

describe('WholesaleArbitration — dispositions list', () => {
  it('renders real dispositions from the paginated list endpoint', async () => {
    (dealAccountingApi.listWholesaleDispositions as any).mockResolvedValue({ items: [DISPOSITION], total: 1, page: 1, pageSize: 50 });
    renderPage();

    await waitFor(() => expect(dealAccountingApi.listWholesaleDispositions).toHaveBeenCalled());
    expect(await screen.findByTestId('wholesale-disposition-row-wd-1')).toBeInTheDocument();
    expect(screen.getByText('1FAKE0000000WHSL1')).toBeInTheDocument();
  });

  it('shows the loading state before the list resolves', () => {
    (dealAccountingApi.listWholesaleDispositions as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('wholesale-dispositions-loading')).toBeInTheDocument();
  });

  it('shows the empty state when there are no dispositions', async () => {
    (dealAccountingApi.listWholesaleDispositions as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    renderPage();
    expect(await screen.findByTestId('wholesale-dispositions-empty')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 403, not fabricated rows', async () => {
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (dealAccountingApi.listWholesaleDispositions as any).mockRejectedValue(forbidden);
    renderPage();
    expect(await screen.findByTestId('wholesale-dispositions-unauthorized')).toBeInTheDocument();
  });

  it('refuses to post the AR leg when title status is not RELEASED, surfacing TITLE_NOT_RELEASED verbatim', async () => {
    (dealAccountingApi.listWholesaleDispositions as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const refusal: any = new Error('Title must be RELEASED to post the wholesale AR leg.');
    refusal.body = { error: 'TITLE_NOT_RELEASED' };
    (dealAccountingApi.disposeWholesale as any).mockRejectedValue(refusal);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('wholesale-new-btn'));
    await user.type(screen.getByTestId('wholesale-unit-ref-input'), '1FAKE0000000WHSL2');
    await user.type(screen.getByTestId('wholesale-title-status-input'), 'PENDING');
    await user.type(screen.getByTestId('wholesale-amount-input'), '8000.00');
    await user.type(screen.getByTestId('wholesale-unit-relief-input'), '7500.00');
    await user.type(screen.getByTestId('wholesale-auction-fees-input'), '150.00');
    await user.type(screen.getByTestId('wholesale-legal-entity-input'), 'entity-kunes-delavan');
    await user.type(screen.getByTestId('wholesale-store-input'), 'STORE-1');
    await user.click(screen.getByTestId('wholesale-new-submit'));

    expect(await screen.findByTestId('wholesale-title-refusal-banner')).toHaveTextContent('Title must be RELEASED');
  });

  it('looks up a disposition by ID and opens its detail drawer', async () => {
    (dealAccountingApi.listWholesaleDispositions as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    (dealAccountingApi.getWholesaleDisposition as any).mockResolvedValue({ disposition: DISPOSITION, arbitrationCases: [] });
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByTestId('wholesale-lookup-input'), 'wd-1');
    await user.click(screen.getByTestId('wholesale-lookup-btn'));

    expect(await screen.findByTestId('wholesale-detail-drawer')).toBeInTheDocument();
    expect(dealAccountingApi.getWholesaleDisposition).toHaveBeenCalledWith('wd-1');
  });
});

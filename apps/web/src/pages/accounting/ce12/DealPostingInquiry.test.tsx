/**
 * CE-12 gap-closure — DealPostingInquiry component tests. Covers the
 * searchable/filterable deal list, the expandable recap-vs-journal detail
 * row, and the new journal drill-down link (GET /api/v1/coa/journals/:number
 * via goldenPathApi.getJournal) on each posted journal segment.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DealPostingInquiry from './DealPostingInquiry';
import { ce12DealApi } from '../../../api/ce12-deal-client';
import { goldenPathApi } from '../../../api/client';

vi.mock('../../../api/ce12-deal-client', async () => {
  const actual = await vi.importActual<any>('../../../api/ce12-deal-client');
  return {
    ...actual,
    ce12DealApi: {
      listDeals: vi.fn(),
      getDeal: vi.fn(),
    },
  };
});

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
      <MemoryRouter>
        <DealPostingInquiry />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DEAL = {
  id: 'deal-1', tenantId: 't1', dealNumber: 'D-1001', dealType: 'RETAIL', vin: '1FAKE0000000INQ01',
  stockNumber: 'STK-1001', legalEntityId: 'entity-kunes-delavan', storeId: 'STORE-1', status: 'POSTED',
  currentRecapVersion: 1, finalizedByActor: 'desk-1', fundedFlag: true, createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
};

const DEAL_DETAIL = {
  deal: DEAL,
  recaps: [{ id: 'r1', tenantId: 't1', dealId: 'deal-1', recapVersion: 1, dealType: 'RETAIL', payload: { saleAmount: '25000.00', unitCostAmount: '20000.00' }, structureHash: 'h1', taxResultId: null, taxAmount: null, hasTradeIn: false, tradeAllowanceAmount: null, tradeAcvAmount: null, rebateReceivableAmount: null, createdAt: '2026-07-01T00:00:00Z', createdBy: 'desk-1' }],
  postingRecords: [{ id: 'pr-1', tenantId: 't1', dealId: 'deal-1', recapVersion: 1, segmentType: 'CORE', productIndex: null, eventId: 'e1', eventType: 'deal.finalized.v1', correlationId: 'c1', coaStatus: 'POSTED', coaExecutionId: 'x1', rulePackVersionId: 'rp-1', ruleId: 'rule-1', journalEntryId: 'je-1', journalNumber: 'JE-100001', blueprintHash: 'bh1', failureReason: null, reversalOfPostingRecordId: null, reversalJournalEntryId: null, reversalJournalNumber: null, reversedAt: null, amountsJson: {}, createdAt: '2026-07-01T00:00:00Z', createdBy: 'desk-1' }],
  reviewCases: [],
  openItems: [],
};

describe('DealPostingInquiry — list, filter, and drill-down', () => {
  it('renders deal rows from the real GET /deals response', async () => {
    (ce12DealApi.listDeals as any).mockResolvedValue({ items: [DEAL] });
    renderPage();

    await waitFor(() => expect(ce12DealApi.listDeals).toHaveBeenCalled());
    expect(await screen.findByTestId('deal-row-D-1001')).toBeInTheDocument();
  });

  it('shows the loading state before the list resolves', () => {
    (ce12DealApi.listDeals as any).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows the empty state when no deal matches the filters', async () => {
    (ce12DealApi.listDeals as any).mockResolvedValue({ items: [DEAL] });
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('deal-row-D-1001');
    await user.type(screen.getByTestId('deal-posting-search-input'), 'NO-SUCH-DEAL');
    expect(await screen.findByTestId('deal-posting-empty')).toBeInTheDocument();
  });

  it('surfaces a permission-denied message on a 403, not a crash', async () => {
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (ce12DealApi.listDeals as any).mockRejectedValue(forbidden);
    renderPage();
    expect(await screen.findByTestId('deal-posting-error')).toHaveTextContent('permission');
  });

  it('expands a deal row and drills into the real coa-service journal from a posted segment', async () => {
    (ce12DealApi.listDeals as any).mockResolvedValue({ items: [DEAL] });
    (ce12DealApi.getDeal as any).mockResolvedValue(DEAL_DETAIL);
    (goldenPathApi.getJournal as any).mockResolvedValue({
      status: 'POSTED', entryDate: '2026-07-01', memo: 'Deal D-1001 core posting', source: '88',
      lines: [{ id: 'l1', accountNumber: '11000', debit: '25000.00', credit: null }, { id: 'l2', accountNumber: '40000', debit: null, credit: '25000.00' }],
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('expand-deal-button-D-1001'));
    await screen.findByTestId('deal-journal-segments-D-1001');
    await user.click(screen.getByTestId('journal-drill-link-pr-1'));

    await waitFor(() => expect(goldenPathApi.getJournal).toHaveBeenCalledWith('JE-100001'));
    expect(await screen.findByTestId('ce12-journal-drill-drawer')).toBeInTheDocument();
    expect(await screen.findByTestId('ce12-journal-drill-detail')).toBeInTheDocument();
  });
});

/**
 * CE-12 / S084-S089 + gap-closure (Lineage, Due Bills) — Deal Accounting
 * Detail UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DealAccountingDetail from './DealAccountingDetail';
import { ce12DealApi } from '../../../api/ce12-deal-client';

vi.mock('../../../api/ce12-deal-client', async () => {
  const actual = await vi.importActual<any>('../../../api/ce12-deal-client');
  return {
    ...actual,
    ce12DealApi: {
      getDeal: vi.fn(),
      getDealLineage: vi.fn(),
      listDueBills: vi.fn(),
      createDueBill: vi.fn(),
      fulfillDueBill: vi.fn(),
      getPayoff: vi.fn(),
      getAuditTrail: vi.fn(),
      unwindDeal: vi.fn(),
      recontractDeal: vi.fn(),
    },
  };
});

function renderPage(dealNumber = 'D-TEST-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/accounting/deals/${dealNumber}`]}>
        <Routes>
          <Route path="/accounting/deals/:dealNumber" element={<DealAccountingDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const DEAL = {
  id: 'deal-1', tenantId: 'tenant-kunes', dealNumber: 'D-TEST-1', dealType: 'RETAIL', vin: '1FTFW1E5XNFA00001',
  stockNumber: 'STK-1', legalEntityId: 'entity-kunes-delavan', storeId: 'STORE-1', status: 'POSTED',
  currentRecapVersion: 1, finalizedByActor: 'desk-1', fundedFlag: true, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
};

const DEAL_DETAIL = {
  deal: DEAL,
  recaps: [{
    id: 'recap-1', tenantId: 'tenant-kunes', dealId: 'deal-1', recapVersion: 1, dealType: 'RETAIL',
    payload: { dealNumber: 'D-TEST-1', recapVersion: 1, dealType: 'RETAIL', stockNumber: 'STK-1', legalEntityId: 'entity-kunes-delavan', storeId: 'STORE-1', businessDate: '2026-08-01', saleAmount: '30000.00', unitCostAmount: '25000.00', hasTradeIn: false },
    structureHash: 'hash-1', taxResultId: null, taxAmount: null, hasTradeIn: false, tradeAllowanceAmount: null, tradeAcvAmount: null, rebateReceivableAmount: null,
    createdAt: '2026-08-01T00:00:00.000Z', createdBy: 'desk-1',
  }],
  postingRecords: [{
    id: 'pr-1', tenantId: 'tenant-kunes', dealId: 'deal-1', recapVersion: 1, segmentType: 'CORE', productIndex: null,
    eventId: 'evt-1', eventType: 'deal.finalized.v1', correlationId: 'corr-1', coaStatus: 'POSTED', coaExecutionId: 'exec-1',
    rulePackVersionId: 'rp-1', ruleId: 'rule-1', journalEntryId: 'je-1', journalNumber: 'DEAL-2026-08-000001',
    blueprintHash: 'bp-1', failureReason: null, reversalOfPostingRecordId: null, reversalJournalEntryId: null,
    reversalJournalNumber: null, reversedAt: null, amountsJson: {}, createdAt: '2026-08-01T00:00:00.000Z', createdBy: 'desk-1',
  }],
  reviewCases: [],
  openItems: [],
};

const LINEAGE = { deal: { dealNumber: 'D-TEST-1', dealType: 'RETAIL', status: 'POSTED', currentRecapVersion: 1 }, chain: [], recontracts: [], unwinds: [] };

describe('DealAccountingDetail', () => {
  it('renders a populated deal detail (happy render)', async () => {
    (ce12DealApi.getDeal as any).mockResolvedValue(DEAL_DETAIL);
    (ce12DealApi.getDealLineage as any).mockResolvedValue(LINEAGE);
    (ce12DealApi.listDueBills as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'D-TEST-1' })).toBeInTheDocument();
    expect(screen.getByTestId('journal-chain-list')).toBeInTheDocument();
    expect(screen.getByText('DEAL-2026-08-000001')).toBeInTheDocument();
  });

  it('shows a loading state before the deal resolves', () => {
    (ce12DealApi.getDeal as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows the not-found state for a 404', async () => {
    const err: any = new Error('Deal not found');
    err.status = 404;
    (ce12DealApi.getDeal as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('deal-detail-not-found')).toBeInTheDocument();
  });

  it('shows the unauthorized message for a 403', async () => {
    const err: any = new Error('Forbidden');
    err.status = 403;
    (ce12DealApi.getDeal as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('deal-detail-error')).toHaveTextContent(/do not have permission/i);
  });

  it('shows the empty state when a deal has no posted journal segments', async () => {
    (ce12DealApi.getDeal as any).mockResolvedValue({ ...DEAL_DETAIL, postingRecords: [] });
    (ce12DealApi.getDealLineage as any).mockResolvedValue(LINEAGE);
    renderPage();
    expect(await screen.findByTestId('journal-chain-empty')).toBeInTheDocument();
  });

  describe('Due Bills tab', () => {
    it('renders the empty state and records a new due-bill', async () => {
      const user = userEvent.setup();
      (ce12DealApi.getDeal as any).mockResolvedValue(DEAL_DETAIL);
      (ce12DealApi.getDealLineage as any).mockResolvedValue(LINEAGE);
      (ce12DealApi.listDueBills as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
      (ce12DealApi.createDueBill as any).mockResolvedValue({
        id: 'db-1', tenantId: 'tenant-kunes', dealId: 'deal-1', itemDescription: 'Second key', amount: '150.00',
        reason: 'promised at delivery', status: 'OPEN', postingRecordId: null, eventId: 'evt-db-1', coaStatus: 'POSTED',
        journalEntryId: 'je-db-1', journalNumber: 'DEAL-2026-08-000099', fulfilledAt: null, fulfilledBy: null,
        idempotencyKey: 'key-1', createdAt: '2026-08-01T00:00:00.000Z', createdBy: 'desk-1',
      });

      renderPage();
      await screen.findByRole('heading', { name: 'D-TEST-1' });
      await user.click(screen.getByTestId('deal-detail-tab-duebills'));
      expect(await screen.findByTestId('due-bills-empty')).toBeInTheDocument();

      await user.type(screen.getByTestId('due-bill-item-description-input'), 'Second key');
      await user.type(screen.getByTestId('due-bill-amount-input'), '150.00');
      await user.type(screen.getByTestId('due-bill-reason-input'), 'promised at delivery');
      await user.click(screen.getByTestId('due-bill-new-submit-button'));

      await waitFor(() => expect(ce12DealApi.createDueBill).toHaveBeenCalledWith({
        dealNumber: 'D-TEST-1', itemDescription: 'Second key', amount: '150.00', reason: 'promised at delivery', idempotencyKey: expect.any(String),
      }));
    });

    it('renders an OPEN due-bill with a Fulfill action, and fulfills it', async () => {
      const user = userEvent.setup();
      (ce12DealApi.getDeal as any).mockResolvedValue(DEAL_DETAIL);
      (ce12DealApi.getDealLineage as any).mockResolvedValue(LINEAGE);
      (ce12DealApi.listDueBills as any).mockResolvedValue({
        items: [{
          id: 'db-1', tenantId: 'tenant-kunes', dealId: 'deal-1', itemDescription: 'Second key', amount: '150.00',
          reason: 'promised at delivery', status: 'OPEN', postingRecordId: null, eventId: 'evt-db-1', coaStatus: 'POSTED',
          journalEntryId: 'je-db-1', journalNumber: 'DEAL-2026-08-000099', fulfilledAt: null, fulfilledBy: null,
          idempotencyKey: 'key-1', createdAt: '2026-08-01T00:00:00.000Z', createdBy: 'desk-1',
        }], total: 1, page: 1, pageSize: 50,
      });
      (ce12DealApi.fulfillDueBill as any).mockResolvedValue({});

      renderPage();
      await screen.findByRole('heading', { name: 'D-TEST-1' });
      await user.click(screen.getByTestId('deal-detail-tab-duebills'));

      const row = await screen.findByTestId('due-bill-row-db-1');
      expect(within(row).getByText('Second key')).toBeInTheDocument();
      expect(within(row).getByText('DEAL-2026-08-000099')).toBeInTheDocument();

      await user.click(within(row).getByTestId('due-bill-fulfill-button-db-1'));
      await waitFor(() => expect(ce12DealApi.fulfillDueBill).toHaveBeenCalledWith('db-1'));
    });

    it('shows an unauthorized/error state when the due-bills list call fails', async () => {
      (ce12DealApi.getDeal as any).mockResolvedValue(DEAL_DETAIL);
      (ce12DealApi.getDealLineage as any).mockResolvedValue(LINEAGE);
      const err: any = new Error('Missing required permission: deal_accounting.duebill.view');
      err.status = 403;
      (ce12DealApi.listDueBills as any).mockRejectedValue(err);

      const user = userEvent.setup();
      renderPage();
      await screen.findByRole('heading', { name: 'D-TEST-1' });
      await user.click(screen.getByTestId('deal-detail-tab-duebills'));
      expect(await screen.findByTestId('due-bills-error')).toHaveTextContent(/not authorized/i);
    });
  });
});

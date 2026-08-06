/**
 * CE-12 gap-closure — BillerWorkbench component tests. Covers the Review
 * Queue panel (now reading dealNumber/dealType directly off the joined
 * GET /review/queue response, per the gap-closure pass) and the new Due
 * Bills (we-owe) panel/ceremony added in this same pass. Mirrors the
 * mocking pattern in ScheduleOpenItems.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BillerWorkbench from './BillerWorkbench';
import { ce12DealApi } from '../../../api/ce12-deal-client';

vi.mock('../../../api/ce12-deal-client', () => ({
  ce12DealApi: {
    getReviewQueue: vi.fn(),
    getPreview: vi.fn(),
    holdReview: vi.fn(),
    returnReview: vi.fn(),
    releaseReview: vi.fn(),
    listDueBills: vi.fn(),
    createDueBill: vi.fn(),
    fulfillDueBill: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BillerWorkbench />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const REVIEW_CASE = {
  id: 'case-1',
  tenantId: 't1',
  dealId: 'deal-1',
  recapVersion: 1,
  status: 'PENDING_REVIEW' as const,
  autoPosted: false,
  heldReason: null, heldBy: null, heldAt: null,
  returnedReason: null, returnedBy: null, returnedAt: null,
  releasedBy: null, releasedAt: null,
  previewBlueprintHash: null,
  createdAt: '2026-07-01T00:00:00Z',
  dealNumber: 'D-1001',
  dealType: 'RETAIL' as const,
  vin: '1FAKE000000000001',
  stockNumber: 'S-1',
  legalEntityId: 'entity-kunes-delavan',
  storeId: 'STORE-1',
};

const DUE_BILL = {
  id: 'db-1', tenantId: 't1', dealId: 'deal-1',
  itemDescription: 'Missing second key', amount: '150.00', reason: 'Ordered, pending delivery',
  status: 'OPEN' as const, postingRecordId: 'pr-1', eventId: 'evt-1', coaStatus: 'POSTED' as const,
  journalEntryId: 'je-1', journalNumber: 'J-9001', fulfilledAt: null, fulfilledBy: null,
  idempotencyKey: 'idem-1', createdAt: '2026-07-01T00:00:00Z', createdBy: 'solera-admin@solera.demo',
};

describe('BillerWorkbench — Review Queue panel', () => {
  it('renders queue rows using the joined dealNumber/dealType directly (no local GET /deals cross-reference)', async () => {
    (ce12DealApi.getReviewQueue as any).mockResolvedValue({ items: [REVIEW_CASE] });
    renderPage();

    await waitFor(() => expect(ce12DealApi.getReviewQueue).toHaveBeenCalled());
    expect(await screen.findByTestId('queue-row-D-1001')).toBeInTheDocument();
    expect(screen.getByText('D-1001')).toBeInTheDocument();
  });

  it('shows the loading state before the queue resolves', () => {
    (ce12DealApi.getReviewQueue as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows the empty state when there are no review cases', async () => {
    (ce12DealApi.getReviewQueue as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('queue-empty')).toBeInTheDocument();
  });

  it('shows a 403-specific message on an API error', async () => {
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (ce12DealApi.getReviewQueue as any).mockRejectedValue(forbidden);
    renderPage();
    expect(await screen.findByTestId('queue-error')).toHaveTextContent('Not authorized');
  });

  it('surfaces the BILLER_SOD_VIOLATION refusal verbatim on release, not a generic error', async () => {
    (ce12DealApi.getReviewQueue as any).mockResolvedValue({ items: [REVIEW_CASE] });
    (ce12DealApi.getPreview as any).mockResolvedValue({ segments: [], combinedBlueprintHash: 'abc' });
    const sodErr: any = new Error('Same actor finalized and released this deal.');
    sodErr.body = { error: 'BILLER_SOD_VIOLATION' };
    (ce12DealApi.releaseReview as any).mockRejectedValue(sodErr);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByTestId('queue-row-D-1001'));
    await user.click(await screen.findByTestId('release-deal-button-D-1001'));

    expect(await screen.findByTestId('release-sod-error')).toHaveTextContent('Segregation-of-duties refusal');
  });
});

describe('BillerWorkbench — Due Bills (we-owe) panel', () => {
  it('lists due-bills and shows a Mark fulfilled action only for OPEN rows', async () => {
    (ce12DealApi.getReviewQueue as any).mockResolvedValue({ items: [] });
    (ce12DealApi.listDueBills as any).mockResolvedValue({ items: [DUE_BILL], total: 1, page: 1, pageSize: 50 });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('biller-page-tab-duebills'));
    expect(await screen.findByTestId('due-bill-row-db-1')).toBeInTheDocument();
    expect(screen.getByTestId('due-bill-fulfill-button-db-1')).toBeInTheDocument();
    expect(screen.getByText('J-9001')).toBeInTheDocument();
  });

  it('shows the empty state when there are no due-bills', async () => {
    (ce12DealApi.getReviewQueue as any).mockResolvedValue({ items: [] });
    (ce12DealApi.listDueBills as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('biller-page-tab-duebills'));
    expect(await screen.findByTestId('due-bill-empty')).toBeInTheDocument();
  });

  it('surfaces a 403 on the due-bills list without fabricating rows', async () => {
    (ce12DealApi.getReviewQueue as any).mockResolvedValue({ items: [] });
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (ce12DealApi.listDueBills as any).mockRejectedValue(forbidden);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('biller-page-tab-duebills'));
    expect(await screen.findByTestId('due-bill-error')).toHaveTextContent('Not authorized');
    expect(screen.queryByTestId('due-bill-row-db-1')).not.toBeInTheDocument();
  });

  it('creates a due-bill with the entered fields and a real idempotency key', async () => {
    (ce12DealApi.getReviewQueue as any).mockResolvedValue({ items: [] });
    (ce12DealApi.listDueBills as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    (ce12DealApi.createDueBill as any).mockResolvedValue(DUE_BILL);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('biller-page-tab-duebills'));
    await user.click(await screen.findByTestId('due-bill-new-button'));
    await user.type(screen.getByTestId('due-bill-deal-number-input'), 'D-1001');
    await user.type(screen.getByTestId('due-bill-item-description-input'), 'Missing second key');
    await user.type(screen.getByTestId('due-bill-amount-input'), '150.00');
    await user.type(screen.getByTestId('due-bill-reason-input'), 'Ordered, pending delivery');
    await user.click(screen.getByTestId('due-bill-new-submit-button'));

    await waitFor(() =>
      expect(ce12DealApi.createDueBill).toHaveBeenCalledWith(
        expect.objectContaining({ dealNumber: 'D-1001', itemDescription: 'Missing second key', amount: '150.00', reason: 'Ordered, pending delivery' }),
      ),
    );
    const call = (ce12DealApi.createDueBill as any).mock.calls[0][0];
    expect(typeof call.idempotencyKey).toBe('string');
    expect(call.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('marks a due-bill fulfilled and does not itself claim schedule relief', async () => {
    (ce12DealApi.getReviewQueue as any).mockResolvedValue({ items: [] });
    (ce12DealApi.listDueBills as any).mockResolvedValue({ items: [DUE_BILL], total: 1, page: 1, pageSize: 50 });
    (ce12DealApi.fulfillDueBill as any).mockResolvedValue({ ...DUE_BILL, status: 'FULFILLED' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('biller-page-tab-duebills'));
    await user.click(await screen.findByTestId('due-bill-fulfill-button-db-1'));

    await waitFor(() => expect(ce12DealApi.fulfillDueBill).toHaveBeenCalledWith('db-1'));
  });
});

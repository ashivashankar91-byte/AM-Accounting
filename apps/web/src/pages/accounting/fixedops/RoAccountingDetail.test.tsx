/**
 * CE-11 / S059-S060 — RO Accounting Detail UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RoAccountingDetail from './RoAccountingDetail';
import { fixedopsApi } from '../../../api/fixedopsApi';

vi.mock('../../../api/fixedopsApi', () => ({
  fixedopsApi: {
    getRo: vi.fn(),
    reopenRo: vi.fn(),
    voidRo: vi.fn(),
    auditTrail: vi.fn(),
  },
}));

function renderPage(path = '/accounting/fixedops/ro/RO-1001?storeId=STORE-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/accounting/fixedops/ro/:roNumber" element={<RoAccountingDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const RO = {
  id: 'ro-1', tenantId: 't1', roNumber: 'RO-1001', storeId: 'STORE-1', legalEntityId: 'entity-1',
  status: 'CLOSED', currentCloseVersion: 1, wipMode: null, openedAt: '2026-07-01T00:00:00.000Z', closedAt: '2026-07-02T00:00:00.000Z',
  closeSubmissions: [{
    id: 'sub-1', roNumber: 'RO-1001', closeVersion: 1, status: 'POSTED', payTypeMix: 'C',
    totalSaleAmount: '500.00', totalCostAmount: '300.00', totalTaxAmount: '0.00',
    journalEntryId: 'je-1', journalNumber: 'JN-0001', rulePackVersionId: 'rpv-1', failureReason: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    lines: [
      { id: 'l1', lineId: 'L1', payType: 'C', category: 'LABOR', opcode: null, techId: null, partNumber: null, saleAmount: '300.00', costAmount: '150.00', taxResultId: null, taxAmount: '0.00' },
      { id: 'l2', lineId: 'L2', payType: 'C', category: 'PARTS', opcode: null, techId: null, partNumber: 'P-1', saleAmount: '200.00', costAmount: '150.00', taxResultId: null, taxAmount: '0.00' },
    ],
  }],
  reversals: [],
};

describe('RoAccountingDetail', () => {
  it('renders RO header and the distribution tab with a conservation badge', async () => {
    (fixedopsApi.getRo as any).mockResolvedValue(RO);
    renderPage();
    expect(await screen.findByTestId('ro-distribution-table')).toBeInTheDocument();
    expect(screen.getByTestId('ro-distribution-conservation-badge')).toHaveTextContent('CONSERVES TO THE CENT');
  });

  it('shows a mismatch badge when line sums do not equal the RO total', async () => {
    const mismatched = { ...RO, closeSubmissions: [{ ...RO.closeSubmissions[0], totalSaleAmount: '999.00' }] };
    (fixedopsApi.getRo as any).mockResolvedValue(mismatched);
    renderPage();
    await screen.findByTestId('ro-distribution-table');
    expect(screen.getByTestId('ro-distribution-conservation-badge')).toHaveTextContent('MISMATCH');
  });

  it('shows the error state on API failure', async () => {
    (fixedopsApi.getRo as any).mockRejectedValue(new Error('RO lookup failed'));
    renderPage();
    expect(await screen.findByTestId('ro-detail-error')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('no permission'); err.status = 401;
    (fixedopsApi.getRo as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('ro-detail-unauthorized')).toBeInTheDocument();
  });

  it('switches tabs: journals shows the reversal chain, schedule shows the PENDING_CE07 banner', async () => {
    const user = userEvent.setup();
    const withReversal = {
      ...RO,
      reversals: [{ id: 'rev-1', roNumber: 'RO-1001', closeVersionReversed: 1, action: 'REOPEN', status: 'COMPLETED', refusalCode: null, reason: null, originalJournalEntryId: 'je-1', reversalJournalEntryId: 'je-2', createdAt: '2026-07-03T00:00:00.000Z' }],
      closeSubmissions: [{ ...RO.closeSubmissions[0], lines: [{ ...RO.closeSubmissions[0].lines[0], payType: 'W' }] }],
    };
    (fixedopsApi.getRo as any).mockResolvedValue(withReversal);
    renderPage();
    await screen.findByTestId('ro-distribution-table');

    await user.click(screen.getByTestId('ro-detail-tab-journals'));
    expect(await screen.findByTestId('ro-reversal-pair-v1')).toBeInTheDocument();

    await user.click(screen.getByTestId('ro-detail-tab-schedule'));
    expect(await screen.findByTestId('ro-schedule-pending-banner')).toBeInTheDocument();
  });

  it('reopen: opens confirmation dialog and calls reopenRo on confirm', async () => {
    const user = userEvent.setup();
    (fixedopsApi.getRo as any).mockResolvedValue({ ...RO, status: 'CLOSED' });
    (fixedopsApi.reopenRo as any).mockResolvedValue({ idempotent: false, reversalId: 'rev-1', status: 'COMPLETED', reversalJournalEntryId: 'je-2' });
    renderPage();
    await screen.findByTestId('ro-distribution-table');

    await user.click(screen.getByTestId('ro-detail-reopen-button'));
    expect(screen.getByTestId('ro-detail-confirm-dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('ro-detail-confirm-submit'));

    await waitFor(() => expect(fixedopsApi.reopenRo).toHaveBeenCalledWith('RO-1001', expect.any(Object)));
    expect(await screen.findByTestId('ro-detail-action-success')).toBeInTheDocument();
  });

  it('shows the refusal reason inline when a reversal is refused', async () => {
    const user = userEvent.setup();
    (fixedopsApi.getRo as any).mockResolvedValue({ ...RO, status: 'CLOSED' });
    (fixedopsApi.reopenRo as any).mockResolvedValue({ idempotent: false, reversalId: 'rev-1', status: 'REFUSED', refusalCode: 'CLAIM_CASH_APPLIED' });
    renderPage();
    await screen.findByTestId('ro-distribution-table');

    await user.click(screen.getByTestId('ro-detail-reopen-button'));
    await user.click(screen.getByTestId('ro-detail-confirm-submit'));

    expect(await screen.findByTestId('ro-detail-action-error')).toHaveTextContent('CLAIM_CASH_APPLIED');
  });
});

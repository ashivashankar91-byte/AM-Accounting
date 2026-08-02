/**
 * CE-11 / S059 — Fixed Ops Posting Inquiry UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FixedOpsPostingInquiry from './FixedOpsPostingInquiry';
import { fixedopsApi } from '../../../api/fixedopsApi';

vi.mock('../../../api/fixedopsApi', () => ({
  fixedopsApi: {
    listPostings: vi.fn(),
    auditGlobal: vi.fn(),
  },
}));

vi.mock('../../../context/EntityScopeContext', () => ({
  useEntityScope: () => ({
    entityId: 'entity-1', entityLabel: '01 — Kunes Auto Group', storeId: null, consolidated: false,
    entities: [], loading: false, noEntitiesConfigured: false, error: null,
    setEntity: vi.fn(), setStore: vi.fn(), setConsolidated: vi.fn(),
  }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/accounting/fixedops/postings']}>
        <FixedOpsPostingInquiry />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const POSTING = {
  id: 'sub-1', roNumber: 'RO-1001', closeVersion: 1, status: 'POSTED', payTypeMix: 'C',
  totalSaleAmount: '500.00', totalCostAmount: '300.00', totalTaxAmount: '40.00',
  journalEntryId: 'je-1', journalNumber: 'JN-0001', rulePackVersionId: 'rpv-1', createdAt: '2026-07-01T00:00:00.000Z',
};

describe('FixedOpsPostingInquiry', () => {
  it('renders a populated postings table', async () => {
    (fixedopsApi.listPostings as any).mockResolvedValue({ items: [POSTING] });
    renderPage();
    expect(await screen.findByTestId('fixedops-postings-table')).toBeInTheDocument();
    expect(screen.getByText('RO-1001')).toBeInTheDocument();
    expect(screen.getByText('JN-0001')).toBeInTheDocument();
  });

  it('shows the empty state when there are no postings', async () => {
    (fixedopsApi.listPostings as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('fixedops-postings-empty')).toBeInTheDocument();
  });

  it('shows the error state on API failure', async () => {
    (fixedopsApi.listPostings as any).mockRejectedValue(new Error('service unreachable'));
    renderPage();
    expect(await screen.findByTestId('fixedops-postings-error')).toBeInTheDocument();
    expect(screen.getByText(/service unreachable/)).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('Missing permission');
    err.status = 403;
    (fixedopsApi.listPostings as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('fixedops-postings-unauthorized')).toBeInTheDocument();
  });

  it('refetches when a filter changes and refresh is clicked', async () => {
    const user = userEvent.setup();
    (fixedopsApi.listPostings as any).mockResolvedValue({ items: [POSTING] });
    renderPage();
    await screen.findByTestId('fixedops-postings-table');

    await user.selectOptions(screen.getByTestId('fixedops-postings-paytype-filter'), 'C');
    await user.click(screen.getByTestId('fixedops-postings-refresh'));

    await waitFor(() => expect(fixedopsApi.listPostings).toHaveBeenCalledWith(expect.objectContaining({ payType: 'C' })));
  });

  it('switches to the global audit tab and loads audit events', async () => {
    const user = userEvent.setup();
    (fixedopsApi.listPostings as any).mockResolvedValue({ items: [] });
    (fixedopsApi.auditGlobal as any).mockResolvedValue({
      items: [{ id: 'ev-1', docType: 'RO_CLOSE_SUBMISSION', docId: 'sub-1', action: 'POSTED', actor: 'clerk-1', correlationId: 'corr-1', reason: null, createdAt: '2026-07-01T00:00:00.000Z' }],
    });
    renderPage();
    await screen.findByTestId('fixedops-postings-empty');

    await user.click(screen.getByTestId('fixedops-postings-tab-audit'));
    expect(await screen.findByTestId('fixedops-audit-table')).toBeInTheDocument();
    await waitFor(() => expect(fixedopsApi.auditGlobal).toHaveBeenCalled());
  });
});

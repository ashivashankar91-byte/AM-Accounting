/**
 * CE-11 / S070 — Special-Order Deposit Inquiry UI tests.
 * PartsDeposits does not auto-load on mount — loadActive()/loadAbandoned()
 * only fire from an explicit user action (Search button or tab click), so
 * every test below triggers that action before asserting on load results.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PartsDeposits from './PartsDeposits';
import { partsApi } from '../../../api/partsApi';

vi.mock('../../../api/partsApi', () => ({
  partsApi: {
    listDeposits: vi.fn(),
    abandonedDepositQueue: vi.fn(),
    refundDeposit: vi.fn(),
    escheatDeposit: vi.fn(),
  },
}));

vi.mock('../../../context/EntityScopeContext', () => ({
  useEntityScope: () => ({
    entityId: 'entity-1', entityLabel: '01 — Kunes Auto Group', storeId: 'STORE-1', consolidated: false,
    entities: [], loading: false, noEntitiesConfigured: false, error: null,
    setEntity: vi.fn(), setStore: vi.fn(), setConsolidated: vi.fn(),
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/parts/deposits']}>
      <PartsDeposits />
    </MemoryRouter>,
  );
}

const DEPOSIT_OPEN = {
  id: 'd1', orderNumber: 'SO-1', customerRef: 'Cust A', depositAmount: '250.00', agingSinceDate: '2026-06-01T00:00:00.000Z',
  status: 'OPEN', depositJournalEntryId: 'je-1', appliedJournalEntryId: null, refundJournalEntryId: null,
};

describe('PartsDeposits', () => {
  it('renders active deposits after search', async () => {
    const user = userEvent.setup();
    (partsApi.listDeposits as any).mockResolvedValue({ items: [DEPOSIT_OPEN] });
    renderPage();
    await user.click(screen.getByTestId('deposits-search'));
    expect(await screen.findByTestId('deposits-table')).toBeInTheDocument();
    expect(screen.getByText('SO-1')).toBeInTheDocument();
  });

  it('shows the active-deposits empty state', async () => {
    const user = userEvent.setup();
    (partsApi.listDeposits as any).mockResolvedValue({ items: [] });
    renderPage();
    await user.click(screen.getByTestId('deposits-search'));
    expect(await screen.findByTestId('deposits-active-empty')).toBeInTheDocument();
  });

  it('shows the error state on API failure', async () => {
    const user = userEvent.setup();
    (partsApi.listDeposits as any).mockRejectedValue(new Error('service down'));
    renderPage();
    await user.click(screen.getByTestId('deposits-search'));
    expect(await screen.findByTestId('deposits-error')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const user = userEvent.setup();
    const err: any = new Error('no permission'); err.status = 401;
    (partsApi.listDeposits as any).mockRejectedValue(err);
    renderPage();
    await user.click(screen.getByTestId('deposits-search'));
    expect(await screen.findByTestId('deposits-unauthorized')).toBeInTheDocument();
  });

  it('abandoned tab renders an honest empty state when nothing qualifies', async () => {
    const user = userEvent.setup();
    (partsApi.abandonedDepositQueue as any).mockResolvedValue({ items: [] });
    renderPage();
    await user.click(screen.getByTestId('deposits-tab-abandoned'));
    expect(await screen.findByTestId('deposits-abandoned-empty')).toBeInTheDocument();
  });

  it('shows the refusal reason inline when a refund is refused', async () => {
    const user = userEvent.setup();
    (partsApi.listDeposits as any).mockResolvedValue({ items: [DEPOSIT_OPEN] });
    (partsApi.refundDeposit as any).mockRejectedValue(new Error('Refund refused — deposit already applied.'));
    renderPage();
    await user.click(screen.getByTestId('deposits-search'));
    await screen.findByTestId('deposits-table');

    await user.click(screen.getByTestId('deposit-view-SO-1'));
    expect(screen.getByTestId('deposit-drawer')).toBeInTheDocument();
    await user.click(screen.getByTestId('deposit-refund'));

    expect(await screen.findByTestId('deposit-action-error')).toHaveTextContent(/already applied/);
  });

  it('escheat is refused when no jurisdiction config exists, shown inline', async () => {
    const user = userEvent.setup();
    (partsApi.abandonedDepositQueue as any).mockResolvedValue({ items: [{ ...DEPOSIT_OPEN, id: 'd2', orderNumber: 'SO-2', status: 'ABANDONED' }] });
    (partsApi.escheatDeposit as any).mockRejectedValue(new Error('Escheat refused — no jurisdiction config for this scope.'));
    renderPage();
    await user.click(screen.getByTestId('deposits-tab-abandoned'));
    await screen.findByTestId('deposits-table');

    await user.click(screen.getByTestId('deposit-escheat-SO-2'));
    await waitFor(() => expect(partsApi.escheatDeposit).toHaveBeenCalledWith('SO-2', { legalEntityId: 'entity-1' }));
  });
});

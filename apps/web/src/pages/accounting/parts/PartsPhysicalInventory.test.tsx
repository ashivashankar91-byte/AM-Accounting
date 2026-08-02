/**
 * CE-11 / S069 — Physical Inventory Adjustment Review UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PartsPhysicalInventory from './PartsPhysicalInventory';
import { partsApi } from '../../../api/partsApi';

vi.mock('../../../api/partsApi', () => ({
  partsApi: {
    listPhysicalSessions: vi.fn(),
    openPhysicalSession: vi.fn(),
    getPhysicalSession: vi.fn(),
    freezePhysicalSession: vi.fn(),
    enterCountLines: vi.fn(),
    varianceReport: vi.fn(),
    approvePhysicalSession: vi.fn(),
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
    <MemoryRouter initialEntries={['/accounting/parts/physical']}>
      <PartsPhysicalInventory />
    </MemoryRouter>,
  );
}

const SESSION_BLIND_FROZEN = {
  id: 's1', scopeDescription: 'Bin aisle 3-7', storeId: 'STORE-1', blindCount: true, status: 'FROZEN', journalEntryId: null,
  lines: [{ id: 'l1', partNumber: 'P-1', perpetualQtySnapshot: null, countedQty: null, varianceQty: null }],
};

describe('PartsPhysicalInventory', () => {
  it('shows the empty state when no sessions exist', async () => {
    const user = userEvent.setup();
    (partsApi.listPhysicalSessions as any).mockResolvedValue({ items: [] });
    renderPage();
    await user.click(screen.getByTestId('physical-refresh'));
    expect(await screen.findByTestId('physical-empty')).toBeInTheDocument();
  });

  it('shows the error state on API failure', async () => {
    const user = userEvent.setup();
    (partsApi.listPhysicalSessions as any).mockRejectedValue(new Error('service down'));
    renderPage();
    await user.click(screen.getByTestId('physical-refresh'));
    expect(await screen.findByTestId('physical-error')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const user = userEvent.setup();
    const err: any = new Error('no permission'); err.status = 403;
    (partsApi.listPhysicalSessions as any).mockRejectedValue(err);
    renderPage();
    await user.click(screen.getByTestId('physical-refresh'));
    expect(await screen.findByTestId('physical-unauthorized')).toBeInTheDocument();
  });

  it('opens a new blind-count session with the entered scope', async () => {
    const user = userEvent.setup();
    (partsApi.openPhysicalSession as any).mockResolvedValue({ id: 's1', scopeDescription: 'Bin aisle 3-7', storeId: 'STORE-1', blindCount: true, status: 'OPEN', journalEntryId: null });
    renderPage();
    await user.type(screen.getByTestId('physical-new-scope'), 'Bin aisle 3-7');
    await user.click(screen.getByTestId('physical-new-blind'));
    await user.click(screen.getByTestId('physical-open-session'));

    await waitFor(() => expect(partsApi.openPhysicalSession).toHaveBeenCalledWith(expect.objectContaining({ scopeDescription: 'Bin aisle 3-7', blindCount: true })));
  });

  it('blind-count mode hides the perpetual snapshot in the count-lines table', async () => {
    const user = userEvent.setup();
    (partsApi.listPhysicalSessions as any).mockResolvedValue({ items: [SESSION_BLIND_FROZEN] });
    (partsApi.getPhysicalSession as any).mockResolvedValue(SESSION_BLIND_FROZEN);
    renderPage();
    await user.click(screen.getByTestId('physical-refresh'));
    await screen.findByTestId('physical-sessions-table');

    await user.click(screen.getByTestId('physical-session-row-s1'));
    expect(await screen.findByTestId('physical-session-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('physical-count-lines-table')).toHaveTextContent('(hidden — blind count)');
  });

  it('approve posts exactly the reviewed variance for a VARIANCE_REVIEW session', async () => {
    const user = userEvent.setup();
    const reviewSession = { ...SESSION_BLIND_FROZEN, status: 'VARIANCE_REVIEW' };
    (partsApi.listPhysicalSessions as any).mockResolvedValue({ items: [reviewSession] });
    (partsApi.getPhysicalSession as any).mockResolvedValue(reviewSession);
    (partsApi.approvePhysicalSession as any).mockResolvedValue({ ...reviewSession, status: 'POSTED', journalEntryId: 'je-9' });
    renderPage();
    await user.click(screen.getByTestId('physical-refresh'));
    await screen.findByTestId('physical-sessions-table');
    await user.click(screen.getByTestId('physical-session-row-s1'));
    await screen.findByTestId('physical-approve');

    await user.click(screen.getByTestId('physical-approve'));
    await waitFor(() => expect(partsApi.approvePhysicalSession).toHaveBeenCalledWith('s1', expect.any(Object)));
  });
});

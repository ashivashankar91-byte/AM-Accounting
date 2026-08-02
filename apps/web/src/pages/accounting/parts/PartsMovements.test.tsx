/**
 * CE-11 / S066 — Parts Movement Accounting Inquiry UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PartsMovements from './PartsMovements';
import { partsApi } from '../../../api/partsApi';

vi.mock('../../../api/partsApi', () => ({
  partsApi: { listMovements: vi.fn() },
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
    <MemoryRouter initialEntries={['/accounting/parts/movements']}>
      <PartsMovements />
    </MemoryRouter>,
  );
}

const MOVEMENT = {
  id: 'm1', tenantId: 't1', legalEntityId: 'entity-1', storeId: 'STORE-1', partNumber: 'P-100',
  movementFamily: 'RO_ISSUE', movementId: 'mv-1', quantity: '2', unitValue: '10.00', totalValue: '20.00',
  sourceDocType: 'RO', sourceDocId: 'RO-1', sourceEventId: 'e1', correlationId: 'c1', businessDate: '2026-08-01T00:00:00.000Z',
  status: 'POSTED', journalEntryId: 'je-1', journalNumber: 'JN-9', negativeOnHandFlag: false, createdAt: '2026-08-01T00:00:00.000Z',
};

describe('PartsMovements', () => {
  it('shows the initial state before any search', () => {
    renderPage();
    expect(screen.getByTestId('parts-movements-initial')).toBeInTheDocument();
  });

  it('renders movement rows after search', async () => {
    const user = userEvent.setup();
    (partsApi.listMovements as any).mockResolvedValue({ items: [MOVEMENT] });
    renderPage();
    await user.click(screen.getByTestId('parts-movements-search'));
    expect(await screen.findByTestId('parts-movements-table')).toBeInTheDocument();
    expect(screen.getByText('P-100')).toBeInTheDocument();
  });

  it('renders a loud negative-on-hand badge when negativeOnHandFlag is true', async () => {
    const user = userEvent.setup();
    (partsApi.listMovements as any).mockResolvedValue({ items: [{ ...MOVEMENT, negativeOnHandFlag: true }] });
    renderPage();
    await user.click(screen.getByTestId('parts-movements-search'));
    expect(await screen.findByTestId('parts-movement-negative-badge-mv-1')).toHaveTextContent('NEGATIVE ON-HAND');
  });

  it('shows the empty state when a search returns nothing', async () => {
    const user = userEvent.setup();
    (partsApi.listMovements as any).mockResolvedValue({ items: [] });
    renderPage();
    await user.click(screen.getByTestId('parts-movements-search'));
    expect(await screen.findByTestId('parts-movements-empty')).toBeInTheDocument();
  });

  it('shows the error state on API failure', async () => {
    const user = userEvent.setup();
    (partsApi.listMovements as any).mockRejectedValue(new Error('service down'));
    renderPage();
    await user.click(screen.getByTestId('parts-movements-search'));
    expect(await screen.findByTestId('parts-movements-error')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const user = userEvent.setup();
    const err: any = new Error('no permission'); err.status = 401;
    (partsApi.listMovements as any).mockRejectedValue(err);
    renderPage();
    await user.click(screen.getByTestId('parts-movements-search'));
    expect(await screen.findByTestId('parts-movements-unauthorized')).toBeInTheDocument();
  });

  it('applies the family filter to the search call', async () => {
    const user = userEvent.setup();
    (partsApi.listMovements as any).mockResolvedValue({ items: [] });
    renderPage();
    await user.selectOptions(screen.getByTestId('parts-movements-family'), 'RO_ISSUE');
    await user.click(screen.getByTestId('parts-movements-search'));
    await waitFor(() => expect(partsApi.listMovements).toHaveBeenCalledWith(expect.objectContaining({ movementFamily: 'RO_ISSUE' })));
  });
});

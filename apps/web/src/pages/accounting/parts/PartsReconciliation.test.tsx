/**
 * CE-11 / S066 — Parts Perpetual-to-GL Reconciliation UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PartsReconciliation from './PartsReconciliation';
import { partsApi } from '../../../api/partsApi';

vi.mock('../../../api/partsApi', () => ({
  partsApi: { listReconciliationRuns: vi.fn(), runReconciliation: vi.fn() },
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
    <MemoryRouter initialEntries={['/accounting/parts/reconciliation']}>
      <PartsReconciliation />
    </MemoryRouter>,
  );
}

const BALANCED_RUN = {
  id: 'r1', tenantId: 't1', legalEntityId: 'entity-1', storeId: 'STORE-1', asOfDate: '2026-08-01T00:00:00.000Z',
  perpetualTotal: '1000.00', glControlTotal: '1000.00', varianceAmount: '0.00', status: 'BALANCED',
  triggeredBy: 'ON_DEMAND', runBy: 'ctrl-1', createdAt: '2026-08-01T00:00:00.000Z',
};
const VARIANCE_RUN = {
  ...BALANCED_RUN, id: 'r2', perpetualTotal: '1050.00', glControlTotal: '1000.00', varianceAmount: '50.00', status: 'VARIANCE',
  varianceLines: [{ id: 'vl1', partNumber: 'P-1', movementId: 'mv-1', explainedAmount: '0.00', unexplainedAmount: '50.00' }],
};

describe('PartsReconciliation', () => {
  it('shows the authoritative-GL-source banner (server-resolved, never client-supplied)', () => {
    renderPage();
    expect(screen.getByTestId('parts-reconciliation-authoritative-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('parts-reconciliation-gl-total')).not.toBeInTheDocument();
  });

  it('renders a BALANCED status badge for a $0-variance run', async () => {
    const user = userEvent.setup();
    (partsApi.listReconciliationRuns as any).mockResolvedValue({ items: [BALANCED_RUN] });
    renderPage();
    // entity field is pre-filled from EntityScopeContext ('entity-1') — no typing needed.
    await user.click(screen.getByTestId('parts-reconciliation-history'));
    expect(await screen.findByTestId('parts-reconciliation-summary-table')).toBeInTheDocument();
    expect(screen.getAllByText('BALANCED').length).toBeGreaterThan(0);
  });

  it('renders a VARIANCE status badge with movement-level drill lines, never hidden', async () => {
    const user = userEvent.setup();
    (partsApi.listReconciliationRuns as any).mockResolvedValue({ items: [VARIANCE_RUN] });
    renderPage();
    // entity field is pre-filled from EntityScopeContext ('entity-1') — no typing needed.
    await user.click(screen.getByTestId('parts-reconciliation-history'));
    expect(await screen.findByTestId('parts-reconciliation-drill-table')).toBeInTheDocument();
    expect(screen.getByTestId('parts-reconciliation-drill-vl1')).toHaveTextContent('50.00');
  });

  it('shows the empty state when no runs exist', async () => {
    const user = userEvent.setup();
    (partsApi.listReconciliationRuns as any).mockResolvedValue({ items: [] });
    renderPage();
    // entity field is pre-filled from EntityScopeContext ('entity-1') — no typing needed.
    await user.click(screen.getByTestId('parts-reconciliation-history'));
    expect(await screen.findByTestId('parts-reconciliation-empty')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const user = userEvent.setup();
    const err: any = new Error('no permission'); err.status = 403;
    (partsApi.listReconciliationRuns as any).mockRejectedValue(err);
    renderPage();
    // entity field is pre-filled from EntityScopeContext ('entity-1') — no typing needed.
    await user.click(screen.getByTestId('parts-reconciliation-history'));
    expect(await screen.findByTestId('parts-reconciliation-unauthorized')).toBeInTheDocument();
  });

  it('runs a new reconciliation with no client-supplied GL figure — the server resolves it', async () => {
    const user = userEvent.setup();
    (partsApi.runReconciliation as any).mockResolvedValue(BALANCED_RUN);
    renderPage();
    await user.click(screen.getByTestId('parts-reconciliation-run'));

    await waitFor(() => expect(partsApi.runReconciliation).toHaveBeenCalledWith(expect.objectContaining({ legalEntityId: 'entity-1' })));
    // Never a glControlTotal key in the request — the browser performs no
    // authoritative variance calculation and supplies no manual figure.
    expect((partsApi.runReconciliation as any).mock.calls[0][0]).not.toHaveProperty('glControlTotal');
    expect(await screen.findByTestId('parts-reconciliation-summary-table')).toBeInTheDocument();
  });

  it('shows an explicit unavailable state when the server reports GL_BALANCE_UNAVAILABLE — never a fabricated result', async () => {
    const user = userEvent.setup();
    const err: any = new Error('coa-service unreachable while fetching balance for account 12000');
    err.body = { error: 'GL_BALANCE_UNAVAILABLE' };
    (partsApi.runReconciliation as any).mockRejectedValue(err);
    renderPage();
    await user.click(screen.getByTestId('parts-reconciliation-run'));

    expect(await screen.findByTestId('parts-reconciliation-gl-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('parts-reconciliation-summary-table')).not.toBeInTheDocument();
  });

  it('shows an explicit unavailable state when the inventory-control account mapping is pending — never a fabricated result', async () => {
    const user = userEvent.setup();
    const err: any = new Error('Account mapping for event family "PARTS_RECONCILIATION" role "INVENTORY_CONTROL" is ACCOUNT_MAPPING_VALUES_PENDING');
    err.body = { error: 'ACCOUNT_MAPPING_VALUES_PENDING' };
    (partsApi.runReconciliation as any).mockRejectedValue(err);
    renderPage();
    await user.click(screen.getByTestId('parts-reconciliation-run'));

    expect(await screen.findByTestId('parts-reconciliation-gl-unavailable')).toBeInTheDocument();
  });
});

/**
 * CE-10 / S124 — Tax Liability Reconciliation UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TaxReconciliation from './TaxReconciliation';
import { taxApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  taxApi: {
    getReconciliation: vi.fn(),
    getReconciliationReport: vi.fn(),
  },
}));

vi.mock('../../../context/EntityScopeContext', () => ({
  useEntityScope: () => ({
    entityId: 'entity-1',
    entityLabel: '01 — Kunes Auto Group',
    consolidated: false,
    entities: [],
    loading: false,
    noEntitiesConfigured: false,
    error: null,
    setEntity: vi.fn(),
    setStore: vi.fn(),
    setConsolidated: vi.fn(),
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/tax/reconciliation']}>
      <TaxReconciliation />
    </MemoryRouter>,
  );
}

const BALANCED_RESULT = {
  period: '2026-07',
  entityId: 'entity-1',
  glMovementSourceIsPending: false,
  rows: [
    { jurisdiction: 'US-CA-STATE', engineSum: '1,000.00', postedSum: '1,000.00', glMovement: '1,000.00', variance: '0.00', balanced: true },
  ],
};

const VARIANCE_RESULT = {
  period: '2026-07',
  entityId: 'entity-1',
  glMovementSourceIsPending: false,
  rows: [
    { jurisdiction: 'US-CA-STATE', engineSum: '1,000.00', postedSum: '950.00', glMovement: '950.00', variance: '50.00', balanced: false },
  ],
};

describe('TaxReconciliation', () => {
  it('renders a BALANCED three-way tie (happy render)', async () => {
    const user = userEvent.setup();
    (taxApi.getReconciliation as any).mockResolvedValue(BALANCED_RESULT);
    renderPage();
    await user.click(screen.getByTestId('tax-reconciliation-run'));
    await waitFor(() => expect(screen.getByTestId('tax-reconciliation-table')).toBeInTheDocument());
    expect(screen.getByText('BALANCED')).toBeInTheDocument();
  });

  it('shows a loud variance banner/badge when the tie does not foot', async () => {
    const user = userEvent.setup();
    (taxApi.getReconciliation as any).mockResolvedValue(VARIANCE_RESULT);
    renderPage();
    await user.click(screen.getByTestId('tax-reconciliation-run'));
    await waitFor(() => expect(screen.getByTestId('tax-reconciliation-table')).toBeInTheDocument());
    expect(screen.getByText('VARIANCE')).toBeInTheDocument();
    expect(screen.getByText(/Unreconciled tax variance detected/)).toBeInTheDocument();
  });

  it('shows an empty state when no jurisdiction activity exists for the scope', async () => {
    const user = userEvent.setup();
    (taxApi.getReconciliation as any).mockResolvedValue({ period: '2026-07', entityId: 'entity-1', glMovementSourceIsPending: false, rows: [] });
    renderPage();
    await user.click(screen.getByTestId('tax-reconciliation-run'));
    await waitFor(() => expect(screen.getByTestId('tax-reconciliation-empty')).toBeInTheDocument());
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const user = userEvent.setup();
    const err: any = new Error('Missing required permission: tax.reconciliation.view');
    err.status = 403;
    (taxApi.getReconciliation as any).mockRejectedValue(err);
    renderPage();
    await user.click(screen.getByTestId('tax-reconciliation-run'));
    await waitFor(() => expect(screen.getByTestId('tax-reconciliation-unauthorized')).toBeInTheDocument());
    expect(screen.getByText(/tax.reconciliation.view/)).toBeInTheDocument();
  });

  it('shows a validation failure when no legal entity is entered', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.clear(screen.getByTestId('tax-reconciliation-entity'));
    await user.click(screen.getByTestId('tax-reconciliation-run'));
    await waitFor(() => expect(screen.getByTestId('tax-reconciliation-error')).toHaveTextContent(/Select a legal entity/));
  });

  it('renders the GL-movement-pending honesty banner when the API flags it', async () => {
    const user = userEvent.setup();
    (taxApi.getReconciliation as any).mockResolvedValue({ ...BALANCED_RESULT, glMovementSourceIsPending: true });
    renderPage();
    await user.click(screen.getByTestId('tax-reconciliation-run'));
    await waitFor(() => expect(screen.getByTestId('tax-reconciliation-gl-pending-banner')).toBeInTheDocument());
    expect(screen.getByText(/GL movement source pending upstream reconciliation \(CE-07\)/)).toBeInTheDocument();
  });
});

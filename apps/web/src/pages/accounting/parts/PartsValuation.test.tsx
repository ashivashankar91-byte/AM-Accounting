/**
 * CE-11 / S067, S068, S072 — Price-Tape / Revaluation & Obsolescence UI tests.
 * No tab auto-loads on mount — every load is triggered by an explicit
 * Refresh button click.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PartsValuation from './PartsValuation';
import { partsApi } from '../../../api/partsApi';

vi.mock('../../../api/partsApi', () => ({
  partsApi: {
    listPriceTapes: vi.fn(),
    loadPriceTape: vi.fn(),
    previewPriceTape: vi.fn(),
    approvePriceTape: vi.fn(),
    listObsolescenceRuns: vi.fn(),
    listScrap: vi.fn(),
    approveObsolescence: vi.fn(),
    getActiveValuationConfig: vi.fn(),
    getValuationConfigHistory: vi.fn(),
    createValuationConfig: vi.fn(),
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
  return render(
    <MemoryRouter initialEntries={['/accounting/parts/valuation']}>
      <PartsValuation />
    </MemoryRouter>,
  );
}

const TAPE_PREVIEWED = { id: 't1', loadBatchId: 'TAPE-1', status: 'PREVIEWED', previewTotal: '150.00', approvedTotal: null };
const TAPE_LOADED_UPWARD = { id: 't2', loadBatchId: 'TAPE-UP', status: 'LOADED', previewTotal: '60.00', approvedTotal: null };
const TAPE_LOADED_DOWNWARD = { id: 't3', loadBatchId: 'TAPE-DOWN', status: 'LOADED', previewTotal: '-30.00', approvedTotal: null };

describe('PartsValuation', () => {
  it('shows the no-auto-post banner on the price-tape tab by default', () => {
    renderPage();
    expect(screen.getByTestId('pricetape-noauto-banner')).toBeInTheDocument();
  });

  it('price-tape tab: shows the empty state, then a populated table after refresh', async () => {
    const user = userEvent.setup();
    (partsApi.listPriceTapes as any).mockResolvedValue({ items: [] });
    renderPage();
    await user.click(screen.getByTestId('pricetape-refresh'));
    expect(await screen.findByTestId('pricetape-empty')).toBeInTheDocument();

    (partsApi.listPriceTapes as any).mockResolvedValue({ items: [TAPE_PREVIEWED] });
    await user.click(screen.getByTestId('pricetape-refresh'));
    expect(await screen.findByTestId('pricetape-table')).toBeInTheDocument();
  });

  it('price-tape: approving posts and the preview-equals-approved proof element renders an exact match', async () => {
    const user = userEvent.setup();
    (partsApi.listPriceTapes as any).mockResolvedValue({ items: [TAPE_PREVIEWED] });
    (partsApi.approvePriceTape as any).mockResolvedValue({ ...TAPE_PREVIEWED, status: 'APPROVED', approvedTotal: '150.00' });
    renderPage();
    await user.click(screen.getByTestId('pricetape-refresh'));
    await screen.findByTestId('pricetape-table');

    await user.click(screen.getByTestId('pricetape-approve-TAPE-1'));
    await waitFor(() => expect(partsApi.approvePriceTape).toHaveBeenCalledWith('TAPE-1', expect.any(Object)));
    expect(await screen.findByTestId('pricetape-preview-equals-approved-proof')).toHaveTextContent('(exact match)');
  });

  it('price-tape: shows the unauthorized state on a 401/403 response', async () => {
    const user = userEvent.setup();
    const err: any = new Error('no permission'); err.status = 403;
    (partsApi.listPriceTapes as any).mockRejectedValue(err);
    renderPage();
    await user.click(screen.getByTestId('pricetape-refresh'));
    expect(await screen.findByTestId('pricetape-unauthorized')).toBeInTheDocument();
  });

  it('price-tape: line-entry form builds real lines and loadPriceTape is called with them (never an empty-lines load)', async () => {
    const user = userEvent.setup();
    (partsApi.listPriceTapes as any).mockResolvedValue({ items: [] });
    (partsApi.loadPriceTape as any).mockResolvedValue({ load: { ...TAPE_LOADED_UPWARD }, idempotent: false });
    renderPage();

    // The Load button stays disabled with zero lines — cannot submit an
    // empty-lines tape (would always fail approval downstream with a
    // non-positive-amount rejection the user can't see from here).
    expect(screen.getByTestId('pricetape-load')).toBeDisabled();

    await user.type(screen.getByTestId('pricetape-new-batch'), 'TAPE-UP');
    await user.type(screen.getByTestId('pricetape-line-part'), 'P-100');
    await user.type(screen.getByTestId('pricetape-line-old'), '10.00');
    await user.type(screen.getByTestId('pricetape-line-new'), '12.50');
    await user.type(screen.getByTestId('pricetape-line-qty'), '24');
    await user.click(screen.getByTestId('pricetape-line-add'));

    expect(screen.getByTestId('pricetape-line-draft-0')).toHaveTextContent('P-100');
    expect(screen.getByTestId('pricetape-load')).toBeEnabled();

    await user.click(screen.getByTestId('pricetape-load'));
    await waitFor(() => expect(partsApi.loadPriceTape).toHaveBeenCalledWith(
      expect.objectContaining({
        legalEntityId: 'entity-1', loadBatchId: 'TAPE-UP',
        lines: [expect.objectContaining({ partNumber: 'P-100', oldValue: '10.00', newValue: '12.50', qtyOnHand: '24' })],
      }),
    ));
  });

  it('price-tape: upward and downward revaluations render distinct direction badges, computed from the preview total, never entered manually', async () => {
    const user = userEvent.setup();
    (partsApi.listPriceTapes as any).mockResolvedValue({ items: [TAPE_LOADED_UPWARD, TAPE_LOADED_DOWNWARD] });
    renderPage();
    await user.click(screen.getByTestId('pricetape-refresh'));
    await screen.findByTestId('pricetape-table');

    expect(screen.getByTestId('pricetape-direction-TAPE-UP')).toHaveTextContent('Upward');
    expect(screen.getByTestId('pricetape-direction-TAPE-DOWN')).toHaveTextContent('Downward');
  });

  it('price-tape: shows an explicit unavailable state on ACCOUNT_MAPPING_VALUES_PENDING, never a fabricated result', async () => {
    const user = userEvent.setup();
    (partsApi.listPriceTapes as any).mockResolvedValue({ items: [TAPE_PREVIEWED] });
    const err: any = new Error('Account mapping for event family "PRICE_TAPE_REVALUATION" role "INVENTORY" is ACCOUNT_MAPPING_VALUES_PENDING');
    err.body = { error: 'ACCOUNT_MAPPING_VALUES_PENDING' };
    (partsApi.approvePriceTape as any).mockRejectedValue(err);
    renderPage();
    await user.click(screen.getByTestId('pricetape-refresh'));
    await screen.findByTestId('pricetape-table');

    await user.click(screen.getByTestId('pricetape-approve-TAPE-1'));
    expect(await screen.findByTestId('pricetape-mapping-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('pricetape-preview-equals-approved-proof')).not.toBeInTheDocument();
  });

  it('obsolescence tab: shows error state on failure, and lets an approver post exactly the preview', async () => {
    const user = userEvent.setup();
    (partsApi.listObsolescenceRuns as any).mockRejectedValue(new Error('service down'));
    (partsApi.listScrap as any).mockResolvedValue({ items: [] });
    renderPage();
    await user.click(screen.getByTestId('valuation-tab-obsolescence'));
    await user.click(screen.getByTestId('obsolescence-refresh'));
    expect(await screen.findByTestId('obsolescence-error')).toBeInTheDocument();

    (partsApi.listObsolescenceRuns as any).mockResolvedValue({ items: [{ id: 'o1', asOfDate: '2026-08-01T00:00:00.000Z', previewTotal: '75.00', status: 'PREVIEWED' }] });
    (partsApi.approveObsolescence as any).mockResolvedValue({ id: 'o1', status: 'APPROVED' });
    await user.click(screen.getByTestId('obsolescence-refresh'));
    await screen.findByTestId('obsolescence-runs-table');
    await user.click(screen.getByTestId('obsolescence-approve-o1'));
    await waitFor(() => expect(partsApi.approveObsolescence).toHaveBeenCalledWith('o1', expect.any(Object)));
  });

  it('config tab: shows the no-active-config empty state, then elects a method (S072 ceremony)', async () => {
    const user = userEvent.setup();
    (partsApi.getActiveValuationConfig as any).mockResolvedValue(null);
    (partsApi.getValuationConfigHistory as any).mockResolvedValue([]);
    renderPage();
    await user.click(screen.getByTestId('valuation-tab-config'));
    await user.click(screen.getByTestId('valuation-refresh'));
    expect(await screen.findByTestId('valuation-no-active')).toBeInTheDocument();

    (partsApi.createValuationConfig as any).mockResolvedValue({ id: 'c1', method: 'REPLACEMENT', effectiveFrom: '2026-08-01', ceremonyApprovedBy: 'ctrl-1' });
    await user.selectOptions(screen.getByTestId('valuation-method'), 'REPLACEMENT');
    await user.type(screen.getByTestId('valuation-approver'), 'ctrl-1');
    await user.click(screen.getByTestId('valuation-submit'));

    await waitFor(() => expect(partsApi.createValuationConfig).toHaveBeenCalledWith(expect.objectContaining({ legalEntityId: 'entity-1', method: 'REPLACEMENT', ceremonyApprovedBy: 'ctrl-1' })));
  });
});

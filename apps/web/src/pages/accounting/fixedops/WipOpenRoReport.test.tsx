/**
 * CE-11 / S061 — WIP Inquiry / Open-RO Report UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WipOpenRoReport from './WipOpenRoReport';
import { fixedopsApi } from '../../../api/fixedopsApi';

vi.mock('../../../api/fixedopsApi', () => ({
  fixedopsApi: {
    wipModeHistory: vi.fn(),
    wipReport: vi.fn(),
    electWipMode: vi.fn(),
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
      <MemoryRouter initialEntries={['/accounting/fixedops/wip']}>
        <WipOpenRoReport />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ROW = { roNumber: 'RO-2001', storeId: 'STORE-1', status: 'OPEN', ageDays: 3, accumulatedValue: 450.5, payTypeMix: 'C', wipMode: 'WIP_MODE' };

describe('WipOpenRoReport', () => {
  it('renders the mode banner and open-RO table', async () => {
    (fixedopsApi.wipModeHistory as any).mockResolvedValue({ items: [{ id: 'w1', legalEntityId: 'entity-1', storeId: null, mode: 'WIP_MODE', effectiveFrom: '2026-01-01', approvedBy: 'ctrl-1', impactPreview: null, createdAt: '2026-01-01T00:00:00.000Z' }] });
    (fixedopsApi.wipReport as any).mockResolvedValue({ rows: [ROW], tie: { reportTotal: 450.5, glWipBalance: 450.5, status: 'BALANCED' } });
    renderPage();
    expect(await screen.findByTestId('wip-table')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('wip-mode-banner')).toHaveTextContent('WIP MODE'));
    expect(screen.getByTestId('wip-tie-strip')).toHaveTextContent('BALANCED');
  });

  it('shows GL_BALANCE_UNAVAILABLE honestly, not a fabricated BALANCED badge', async () => {
    (fixedopsApi.wipModeHistory as any).mockResolvedValue({ items: [] });
    (fixedopsApi.wipReport as any).mockResolvedValue({ rows: [ROW], tie: { reportTotal: 450.5, glWipBalance: null, status: 'GL_BALANCE_UNAVAILABLE' } });
    renderPage();
    expect(await screen.findByTestId('wip-tie-strip')).toHaveTextContent('GL BALANCE NOT SUPPLIED');
  });

  it('shows the empty state when there are no open ROs', async () => {
    (fixedopsApi.wipModeHistory as any).mockResolvedValue({ items: [] });
    (fixedopsApi.wipReport as any).mockResolvedValue({ rows: [], tie: { reportTotal: 0, glWipBalance: null, status: 'GL_BALANCE_UNAVAILABLE' } });
    renderPage();
    expect(await screen.findByTestId('wip-empty')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    (fixedopsApi.wipModeHistory as any).mockResolvedValue({ items: [] });
    const err: any = new Error('no permission'); err.status = 403;
    (fixedopsApi.wipReport as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('wip-unauthorized')).toBeInTheDocument();
  });

  it('opens the WIP-mode election ceremony dialog and submits', async () => {
    const user = userEvent.setup();
    (fixedopsApi.wipModeHistory as any).mockResolvedValue({ items: [] });
    (fixedopsApi.wipReport as any).mockResolvedValue({ rows: [], tie: { reportTotal: 0, glWipBalance: null, status: 'GL_BALANCE_UNAVAILABLE' } });
    (fixedopsApi.electWipMode as any).mockResolvedValue({ id: 'w2', legalEntityId: 'entity-1', storeId: null, mode: 'DIRECT_MODE', effectiveFrom: '2026-08-01', approvedBy: 'ctrl-1', impactPreview: null, createdAt: '2026-08-01T00:00:00.000Z' });
    renderPage();
    await screen.findByTestId('wip-empty');

    await user.click(screen.getByTestId('wip-elect-open-button'));
    expect(screen.getByTestId('wip-elect-dialog')).toBeInTheDocument();
    await user.selectOptions(screen.getByTestId('wip-elect-mode-select'), 'DIRECT_MODE');
    await user.click(screen.getByTestId('wip-elect-submit'));

    await waitFor(() => expect(fixedopsApi.electWipMode).toHaveBeenCalledWith(expect.objectContaining({ legalEntityId: 'entity-1', mode: 'DIRECT_MODE' })));
  });
});

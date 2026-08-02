/**
 * CE-11 S063 gap-closure — Labor Rate Configuration UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LaborRateConfig from './LaborRateConfig';
import { fixedopsApi } from '../../../api/fixedopsApi';

vi.mock('../../../api/fixedopsApi', () => ({
  fixedopsApi: {
    listLaborRates: vi.fn(),
    setLaborRate: vi.fn(),
    listTechGuaranteeConfig: vi.fn(),
    setTechGuaranteeConfig: vi.fn(),
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
      <MemoryRouter initialEntries={['/accounting/fixedops/labor-rate']}>
        <LaborRateConfig />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const RATE_ROW = { id: 'lr1', tenantId: 't1', legalEntityId: 'entity-1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '32.75', effectiveFrom: '2020-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'ctrl-1' };
const GUARANTEE_ROW = { id: 'g1', tenantId: 't1', legalEntityId: 'entity-1', techId: 'TECH-1', guaranteedHoursPerPeriod: '72.00', effectiveFrom: '2020-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'ctrl-1' };

describe('LaborRateConfig', () => {
  it('renders the policy banner and the labor-rate table', async () => {
    (fixedopsApi.listLaborRates as any).mockResolvedValue({ items: [RATE_ROW] });
    (fixedopsApi.listTechGuaranteeConfig as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(screen.getByTestId('labor-rate-policy-banner')).toBeInTheDocument();
    expect(await screen.findByTestId('labor-rate-table')).toBeInTheDocument();
    expect(screen.getByTestId('labor-rate-row-lr1')).toHaveTextContent('TECH-1');
    expect(screen.getByTestId('labor-rate-row-lr1')).toHaveTextContent('32.75');
  });

  it('renders the guarantee-config table', async () => {
    (fixedopsApi.listLaborRates as any).mockResolvedValue({ items: [] });
    (fixedopsApi.listTechGuaranteeConfig as any).mockResolvedValue({ items: [GUARANTEE_ROW] });
    renderPage();
    expect(await screen.findByTestId('guarantee-table')).toBeInTheDocument();
    expect(screen.getByTestId('guarantee-row-g1')).toHaveTextContent('72.00');
  });

  it('shows empty states when nothing is configured', async () => {
    (fixedopsApi.listLaborRates as any).mockResolvedValue({ items: [] });
    (fixedopsApi.listTechGuaranteeConfig as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('labor-rate-empty')).toBeInTheDocument();
    expect(await screen.findByTestId('guarantee-empty')).toBeInTheDocument();
  });

  it('submits a new technician-specific rate via the governed ceremony', async () => {
    const user = userEvent.setup();
    (fixedopsApi.listLaborRates as any).mockResolvedValue({ items: [] });
    (fixedopsApi.listTechGuaranteeConfig as any).mockResolvedValue({ items: [] });
    (fixedopsApi.setLaborRate as any).mockResolvedValue(RATE_ROW);
    renderPage();
    await screen.findByTestId('labor-rate-form');

    await user.type(screen.getByTestId('labor-rate-subject-key'), 'TECH-1');
    await user.type(screen.getByTestId('labor-rate-amount'), '32.75');
    await user.click(screen.getByTestId('labor-rate-submit'));

    await waitFor(() => expect(fixedopsApi.setLaborRate).toHaveBeenCalledWith(
      expect.objectContaining({ legalEntityId: 'entity-1', scope: 'TECHNICIAN', subjectKey: 'TECH-1', burdenedRate: '32.75' }),
    ));
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('no permission'); err.status = 403;
    (fixedopsApi.listLaborRates as any).mockRejectedValue(err);
    (fixedopsApi.listTechGuaranteeConfig as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('labor-rate-unauthorized')).toBeInTheDocument();
  });
});

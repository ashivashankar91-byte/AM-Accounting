/**
 * CE-11 S063 gap-closure — Unapplied Time Absorption UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TechTimeAbsorption from './TechTimeAbsorption';
import { fixedopsApi } from '../../../api/fixedopsApi';

vi.mock('../../../api/fixedopsApi', () => ({
  fixedopsApi: {
    listTechTimeAbsorptions: vi.fn(),
    absorbTechTime: vi.fn(),
    reverseTechTime: vi.fn(),
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
      <MemoryRouter initialEntries={['/accounting/fixedops/tech-time']}>
        <TechTimeAbsorption />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const POSTED_ROW = {
  id: 'a1', tenantId: 't1', legalEntityId: 'entity-1', techId: 'TECH-1', deptCode: 'SVC', payrollPeriodId: 'PP-2026-08',
  clockedHours: '70', flaggedAppliedHours: '60', unappliedHours: '10', guaranteedHours: '72', shortfallHours: '12',
  rateId: 'r1', rateSource: 'TECHNICIAN', rateAmount: '32.75', rateEffectiveFrom: '2020-01-01', unappliedAmount: '327.50', shortfallAmount: '393.00',
  sourceEventId: 's1', correlationId: 'c1', status: 'POSTED', journalEntryId: 'j1', createdAt: '2026-08-01T00:00:00.000Z',
};

describe('TechTimeAbsorption', () => {
  it('renders the absorption history table with rate detail', async () => {
    (fixedopsApi.listTechTimeAbsorptions as any).mockResolvedValue({ items: [POSTED_ROW] });
    renderPage();
    expect(await screen.findByTestId('tech-time-table')).toBeInTheDocument();
    const row = screen.getByTestId('tech-time-row-a1');
    expect(row).toHaveTextContent('TECH-1');
    expect(row).toHaveTextContent('TECHNICIAN');
    expect(row).toHaveTextContent('32.75');
    expect(row).toHaveTextContent('POSTED');
  });

  it('shows the empty state when no absorption runs exist', async () => {
    (fixedopsApi.listTechTimeAbsorptions as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('tech-time-empty')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('no permission'); err.status = 403;
    (fixedopsApi.listTechTimeAbsorptions as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('tech-time-unauthorized')).toBeInTheDocument();
  });

  it('shows an explicit RATE_GAP unavailable state — never a fabricated result', async () => {
    const user = userEvent.setup();
    (fixedopsApi.listTechTimeAbsorptions as any).mockResolvedValue({ items: [] });
    const err: any = new Error('No burdened labor-cost rate resolves for technician "TECH-X"');
    err.body = { error: 'RATE_GAP' };
    (fixedopsApi.absorbTechTime as any).mockRejectedValue(err);
    renderPage();
    await screen.findByTestId('tech-time-absorb-form');

    await user.type(screen.getByTestId('absorb-tech-id'), 'TECH-X');
    await user.type(screen.getByTestId('absorb-dept-code'), 'SVC');
    await user.type(screen.getByTestId('absorb-payroll-period'), 'PP-2026-09');
    await user.type(screen.getByTestId('absorb-clocked-hours'), '40');
    await user.type(screen.getByTestId('absorb-flagged-hours'), '30');
    await user.click(screen.getByTestId('absorb-submit'));

    expect(await screen.findByTestId('tech-time-rate-gap')).toBeInTheDocument();
    expect(screen.queryByTestId('tech-time-mapping-pending')).not.toBeInTheDocument();
  });

  it('shows an explicit ACCOUNT_MAPPING_PENDING unavailable state — never a fabricated result', async () => {
    const user = userEvent.setup();
    (fixedopsApi.listTechTimeAbsorptions as any).mockResolvedValue({ items: [] });
    const err: any = new Error('Account mapping is ACCOUNT_MAPPING_VALUES_PENDING for eventFamily=UNAPPLIED_TIME_ABSORPTION');
    err.body = { error: 'ACCOUNT_MAPPING_PENDING' };
    (fixedopsApi.absorbTechTime as any).mockRejectedValue(err);
    renderPage();
    await screen.findByTestId('tech-time-absorb-form');

    await user.type(screen.getByTestId('absorb-tech-id'), 'TECH-Y');
    await user.type(screen.getByTestId('absorb-dept-code'), 'SVC');
    await user.type(screen.getByTestId('absorb-payroll-period'), 'PP-2026-09');
    await user.type(screen.getByTestId('absorb-clocked-hours'), '40');
    await user.type(screen.getByTestId('absorb-flagged-hours'), '30');
    await user.click(screen.getByTestId('absorb-submit'));

    expect(await screen.findByTestId('tech-time-mapping-pending')).toBeInTheDocument();
  });

  it('reverses a POSTED absorption via the real action', async () => {
    const user = userEvent.setup();
    (fixedopsApi.listTechTimeAbsorptions as any).mockResolvedValue({ items: [POSTED_ROW] });
    (fixedopsApi.reverseTechTime as any).mockResolvedValue({ idempotent: false, id: 'rev1', status: 'COMPLETED' });
    renderPage();
    await screen.findByTestId('tech-time-table');

    await user.click(screen.getByTestId('reverse-a1'));

    await waitFor(() => expect(fixedopsApi.reverseTechTime).toHaveBeenCalledWith(
      expect.objectContaining({ legalEntityId: 'entity-1', techId: 'TECH-1', payrollPeriodId: 'PP-2026-08' }),
    ));
  });
});

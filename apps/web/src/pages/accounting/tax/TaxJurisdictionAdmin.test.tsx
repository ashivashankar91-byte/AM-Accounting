/**
 * CE-10 / S124 — Jurisdiction Administration UI tests. Mirrors the
 * QueryClientProvider + vi.mock('../../../api/client') pattern used by
 * VendorMaintenance.test.tsx / VendorInvoices.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaxJurisdictionAdmin from './TaxJurisdictionAdmin';
import { taxApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  taxApi: {
    listJurisdictions: vi.fn(),
    createJurisdiction: vi.fn(),
    updateJurisdiction: vi.fn(),
    deactivateJurisdiction: vi.fn(),
    getAuditTrail: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/accounting/tax/jurisdictions']}>
        <TaxJurisdictionAdmin />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ROW = {
  id: 'j-1',
  jurisdictionRefId: 'US-CA-STATE',
  jurisdictionLabel: 'California (State)',
  registrationNumber: 'REG-100',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  isActive: true,
  version: 1,
};

describe('TaxJurisdictionAdmin', () => {
  it('renders a populated jurisdiction table (happy render)', async () => {
    (taxApi.listJurisdictions as any).mockResolvedValue({ items: [ROW], total: 1 });
    renderPage();
    expect(await screen.findByTestId('tax-jurisdiction-table')).toBeInTheDocument();
    expect(screen.getByText('California (State)')).toBeInTheDocument();
    expect(screen.getByText('REG-100')).toBeInTheDocument();
  });

  it('shows an empty state when there are no jurisdiction registrations', async () => {
    (taxApi.listJurisdictions as any).mockResolvedValue({ items: [], total: 0 });
    renderPage();
    expect(await screen.findByTestId('tax-jurisdictions-empty')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('Missing required permission: tax.jurisdiction.view');
    err.status = 403;
    (taxApi.listJurisdictions as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('tax-jurisdictions-unauthorized')).toBeInTheDocument();
    expect(screen.getByText(/tax.jurisdiction.view/)).toBeInTheDocument();
  });

  it('surfaces an overlap validation failure inline in the drawer', async () => {
    const user = userEvent.setup();
    (taxApi.listJurisdictions as any).mockResolvedValue({ items: [ROW], total: 1 });
    const err: any = new Error('Overlapping registration exists for jurisdiction US-CA-STATE in this date range.');
    err.status = 409;
    (taxApi.createJurisdiction as any).mockRejectedValue(err);
    renderPage();

    await screen.findByTestId('tax-jurisdiction-table');
    await user.click(screen.getByTestId('tax-jurisdiction-new-btn'));
    await user.type(screen.getByTestId('tax-jurisdiction-ref-input'), 'US-CA-STATE');
    await user.type(screen.getByTestId('tax-jurisdiction-effective-from-input'), '2026-06-01');
    await user.click(screen.getByTestId('tax-jurisdiction-drawer-submit'));

    await waitFor(() => expect(screen.getByTestId('tax-jurisdiction-drawer-message')).toHaveTextContent(/Overlapping registration/));
  });
});

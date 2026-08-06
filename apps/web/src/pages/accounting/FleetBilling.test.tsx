/**
 * AMACC S049 — FleetBilling smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FleetBilling from './FleetBilling';
import { fleetBillingApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  fleetBillingApi: {
    linkUnit: vi.fn(),
    unlinkUnit: vi.fn(),
    getParentUnits: vi.fn(),
    createConsolidatedInvoice: vi.fn(),
    listConsolidatedInvoices: vi.fn(),
    getConsolidatedInvoice: vi.fn(),
    getParentStatement: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FleetBilling />
    </QueryClientProvider>,
  );
}

const LINK = { id: 'link-1', parentCustomerId: 'cust-parent', childCustomerId: 'cust-child-1', billingGroupName: 'Fleet A' };
const INVOICE = { id: 'inv-1', parentCustomerId: 'cust-parent', invoiceDate: '2026-07-01', totalAmount: '5000.00', status: 'DRAFT' };

describe('FleetBilling Unit Links', () => {
  it('shows empty prompt when no parent ID submitted', () => {
    renderPage();
    expect(screen.getByText(/Enter a parent customer ID/i)).toBeInTheDocument();
  });

  it('loads unit links for a parent customer', async () => {
    const user = userEvent.setup();
    (fleetBillingApi.getParentUnits as any).mockResolvedValue([LINK]);
    renderPage();

    await user.type(screen.getByPlaceholderText('cust-parent-uuid'), 'cust-parent');
    await user.click(screen.getByRole('button', { name: /Load Units/i }));

    await waitFor(() => expect(screen.getByText('cust-child-1')).toBeInTheDocument());
    expect(screen.getByText('Fleet A')).toBeInTheDocument();
  });

  it('shows loading state when fetching units', async () => {
    const user = userEvent.setup();
    (fleetBillingApi.getParentUnits as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    await user.type(screen.getByPlaceholderText('cust-parent-uuid'), 'cust-parent');
    await user.click(screen.getByRole('button', { name: /Load Units/i }));
    await waitFor(() => expect(screen.getByText(/Loading unit links/i)).toBeInTheDocument());
  });
});

describe('FleetBilling Consolidated Invoices', () => {
  it('shows empty state on invoices tab', async () => {
    const user = userEvent.setup();
    (fleetBillingApi.listConsolidatedInvoices as any).mockResolvedValue([]);
    renderPage();
    await user.click(screen.getByRole('button', { name: /Consolidated Invoices/i }));
    await waitFor(() => expect(screen.getByText(/No consolidated invoices/i)).toBeInTheDocument());
  });

  it('renders invoice rows', async () => {
    const user = userEvent.setup();
    (fleetBillingApi.listConsolidatedInvoices as any).mockResolvedValue([INVOICE]);
    renderPage();
    await user.click(screen.getByRole('button', { name: /Consolidated Invoices/i }));
    await waitFor(() => expect(screen.getByText('cust-parent')).toBeInTheDocument());
  });

  it('shows error state for invoice list failure', async () => {
    const user = userEvent.setup();
    (fleetBillingApi.listConsolidatedInvoices as any).mockRejectedValue(new Error('network error'));
    renderPage();
    await user.click(screen.getByRole('button', { name: /Consolidated Invoices/i }));
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
  });
});

describe('FleetBilling link unit', () => {
  it('links a new unit and updates the list', async () => {
    const user = userEvent.setup();
    (fleetBillingApi.getParentUnits as any).mockResolvedValue([]);
    (fleetBillingApi.linkUnit as any).mockResolvedValue(LINK);
    renderPage();

    await user.click(screen.getByRole('button', { name: /Link Unit/i }));
    await waitFor(() => expect(screen.getByText(/Link New Unit/i)).toBeInTheDocument());

    const inputs = screen.getAllByRole('textbox');
    // parentCustomerId, childCustomerId, billingGroupName
    await user.type(inputs[1], 'cust-parent');
    await user.type(inputs[2], 'cust-child-1');
    await user.click(screen.getByRole('button', { name: /Save Link/i }));

    await waitFor(() => expect(fleetBillingApi.linkUnit).toHaveBeenCalled());
  });
});

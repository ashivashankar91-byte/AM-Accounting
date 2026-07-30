/**
 * AMACC-CH04 S039 — VendorInvoices UI smoke tests. Mirrors the pattern in
 * VendorMaintenance.test.tsx (first frontend test file in this repo).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VendorInvoices from './VendorInvoices';
import { aparApi, apInvoiceApi, purchaseOrderApi, invoiceApprovalApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  aparApi: { getVendors: vi.fn() },
  apInvoiceApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    runMatch: vi.fn(),
    submit: vi.fn(),
    void: vi.fn(),
    checkDuplicates: vi.fn(),
  },
  purchaseOrderApi: { list: vi.fn() },
  invoiceApprovalApi: {
    getInstance: vi.fn(),
    start: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
    retryGlPosting: vi.fn(),
  },
}));

function renderPage(initialPath = '/accounting/ap/invoices') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/accounting/ap/invoices" element={<VendorInvoices />} />
          <Route path="/accounting/ap/invoices/:id" element={<VendorInvoices />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const VENDOR = { id: 'v-1', vendorNumber: '000001', vendorName: 'Acme Supply', status: 'ACTIVE' };

const INVOICE = {
  id: 'inv-1',
  vendorId: 'v-1',
  invoiceNumber: 'INV-100',
  invoiceDate: '2026-07-01',
  dueDate: '2026-07-31',
  totalAmount: '250.00',
  status: 'DRAFT',
  matchType: 'NONE',
  matchStatus: 'NOT_RUN',
  version: 1,
  lines: [],
};

describe('VendorInvoices list', () => {
  it('shows an empty state when there are no invoices', async () => {
    (apInvoiceApi.list as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    (aparApi.getVendors as any).mockResolvedValue({ items: [VENDOR], total: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No vendor invoices yet/i)).toBeInTheDocument());
  });

  it('renders invoice rows once loaded', async () => {
    (apInvoiceApi.list as any).mockResolvedValue({ items: [INVOICE], total: 1, page: 1, pageSize: 50 });
    (aparApi.getVendors as any).mockResolvedValue({ items: [VENDOR], total: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByText('INV-100')).toBeInTheDocument());
    expect(screen.getByText('Acme Supply')).toBeInTheDocument();
    expect(screen.getByText('$250.00')).toBeInTheDocument();
  });

  it('shows an error state with retry when the invoice list fails to load', async () => {
    const err: any = new Error('apar-service unreachable');
    (apInvoiceApi.list as any).mockRejectedValue(err);
    (aparApi.getVendors as any).mockResolvedValue({ items: [], total: 0 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
  });

  it('creates a new DRAFT invoice via the New Invoice dialog', async () => {
    const user = userEvent.setup();
    (apInvoiceApi.list as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    (aparApi.getVendors as any).mockResolvedValue({ items: [VENDOR], total: 1 });
    (apInvoiceApi.create as any).mockResolvedValue(INVOICE);
    (apInvoiceApi.getById as any).mockResolvedValue(INVOICE);
    renderPage();

    await waitFor(() => expect(screen.getByText(/No vendor invoices yet/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /New Invoice/i }));

    await user.selectOptions(screen.getAllByRole('combobox')[0], VENDOR.id);
    const invoiceNumberInput = screen.getByPlaceholderText('INV-1001');
    await user.type(invoiceNumberInput, 'INV-100');

    const descInputs = screen.getAllByPlaceholderText('Description');
    await user.type(descInputs[0], 'Shop supplies');
    const glInputs = screen.getAllByPlaceholderText('GL Account ID');
    await user.type(glInputs[0], '22222222-2222-2222-2222-222222222222');

    // unitPrice field is the numeric input in the line row without a placeholder — grab all numeric spinbuttons
    const numberInputs = screen.getAllByRole('spinbutton');
    // [freight, quantity, unitPrice, tax] order per the rendered form
    await user.clear(numberInputs[2]);
    await user.type(numberInputs[2], '250');

    await user.click(screen.getByRole('button', { name: /Save Draft/i }));

    await waitFor(() => expect(apInvoiceApi.create).toHaveBeenCalled());
  });
});

describe('VendorInvoices detail', () => {
  it('renders invoice detail and runs a match', async () => {
    const user = userEvent.setup();
    (apInvoiceApi.getById as any).mockResolvedValue(INVOICE);
    (apInvoiceApi.runMatch as any).mockResolvedValue({ invoice: { ...INVOICE, matchStatus: 'MATCHED' }, result: { status: 'MATCHED', variances: [] } });
    renderPage('/accounting/ap/invoices/inv-1');

    await waitFor(() => expect(screen.getByText(/Invoice INV-100/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Run Match/i }));
    await waitFor(() => expect(apInvoiceApi.runMatch).toHaveBeenCalledWith('inv-1'));
  });
});

describe('VendorInvoices approval panel (S041)', () => {
  it('shows Start Approval for a SUBMITTED invoice and starts the workflow', async () => {
    const user = userEvent.setup();
    const submittedInvoice = { ...INVOICE, status: 'SUBMITTED', matchStatus: 'MATCHED' };
    (apInvoiceApi.getById as any).mockResolvedValue(submittedInvoice);
    (invoiceApprovalApi.start as any).mockResolvedValue({ id: 'instance-1', status: 'PENDING', steps: [{ id: 'step-1', sequence: 1, requiredRole: 'ANY_APPROVER', status: 'PENDING' }] });
    (invoiceApprovalApi.getInstance as any).mockResolvedValue({ id: 'instance-1', status: 'PENDING', steps: [{ id: 'step-1', sequence: 1, requiredRole: 'ANY_APPROVER', status: 'PENDING' }] });
    renderPage('/accounting/ap/invoices/inv-1');

    await waitFor(() => expect(screen.getByText(/Invoice INV-100/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Start Approval/i }));
    await waitFor(() => expect(invoiceApprovalApi.start).toHaveBeenCalledWith('inv-1'));
  });

  it('shows the approve action for a PENDING_APPROVAL invoice and approves the current tier', async () => {
    const user = userEvent.setup();
    const pendingInvoice = { ...INVOICE, status: 'PENDING_APPROVAL', matchStatus: 'MATCHED' };
    (apInvoiceApi.getById as any).mockResolvedValue(pendingInvoice);
    (invoiceApprovalApi.getInstance as any).mockResolvedValue({
      id: 'instance-1', status: 'PENDING',
      steps: [{ id: 'step-1', sequence: 1, requiredRole: 'ANY_APPROVER', status: 'PENDING' }],
    });
    (invoiceApprovalApi.approve as any).mockResolvedValue({ id: 'instance-1', status: 'APPROVED', steps: [] });
    renderPage('/accounting/ap/invoices/inv-1');

    await waitFor(() => expect(screen.getByText(/Approve \(tier 1\)/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Approve \(tier 1\)/i }));
    await waitFor(() => expect(invoiceApprovalApi.approve).toHaveBeenCalledWith('inv-1', { version: pendingInvoice.version }));
  });

  it('shows a retry action when an APPROVED invoice has no posted GL entry yet', async () => {
    const approvedInvoice = { ...INVOICE, status: 'APPROVED', matchStatus: 'MATCHED', approvalGlEntryId: null };
    (apInvoiceApi.getById as any).mockResolvedValue(approvedInvoice);
    (invoiceApprovalApi.getInstance as any).mockResolvedValue({
      id: 'instance-1', status: 'APPROVED',
      steps: [{ id: 'step-1', sequence: 1, requiredRole: 'ANY_APPROVER', status: 'APPROVED', decidedBy: 'user-1' }],
    });
    renderPage('/accounting/ap/invoices/inv-1');

    await waitFor(() => expect(screen.getByText(/GL liability posting has not completed yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry GL Posting/i })).toBeInTheDocument();
  });
});

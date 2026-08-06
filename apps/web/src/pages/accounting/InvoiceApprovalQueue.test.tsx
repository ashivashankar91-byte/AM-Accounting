import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvoiceApprovalQueue from './InvoiceApprovalQueue';
import { apInvoiceApi, invoiceApprovalApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  apInvoiceApi: {
    list: vi.fn(),
    void: vi.fn(),
  },
  invoiceApprovalApi: {
    getInstance: vi.fn(),
    approve: vi.fn(),
    reject: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InvoiceApprovalQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function apiError(status: number, body: any) {
  const err: any = new Error(body?.message ?? `API error ${status}`);
  err.status = status;
  err.body = body;
  return err;
}

const PENDING_INVOICE = {
  id: 'inv-1',
  invoiceNumber: 'INV-100',
  vendorId: 'v-1',
  invoiceDate: '2026-07-01',
  dueDate: '2026-07-31',
  totalAmount: '500.00',
  status: 'PENDING_APPROVAL',
  version: 2,
  submittedBy: 'user-other',
};

const APPROVAL_INSTANCE = {
  id: 'inst-1',
  status: 'PENDING',
  steps: [{ id: 'step-1', sequence: 1, requiredRole: 'ANY_APPROVER', status: 'PENDING' }],
};

beforeEach(() => {
  vi.mocked(apInvoiceApi.list).mockReset();
  vi.mocked(invoiceApprovalApi.getInstance).mockReset();
  vi.mocked(invoiceApprovalApi.approve).mockReset();
  vi.mocked(invoiceApprovalApi.reject).mockReset();
  vi.mocked(apInvoiceApi.void).mockReset();
  // default localStorage — no current user set
  localStorage.clear();
});

describe('InvoiceApprovalQueue', () => {
  it('shows loading state', () => {
    vi.mocked(apInvoiceApi.list).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('shows empty state when queue is empty', async () => {
    vi.mocked(apInvoiceApi.list).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No invoices pending approval/i)).toBeInTheDocument());
  });

  it('shows error state with retry when list fails', async () => {
    vi.mocked(apInvoiceApi.list).mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows unauthorized state for 403 error', async () => {
    vi.mocked(apInvoiceApi.list).mockRejectedValue(apiError(403, { message: 'Forbidden' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument());
  });

  it('renders invoice rows when loaded', async () => {
    vi.mocked(apInvoiceApi.list).mockResolvedValue({ items: [PENDING_INVOICE], total: 1, page: 1, pageSize: 100 });
    renderPage();
    await waitFor(() => expect(screen.getByText('INV-100')).toBeInTheDocument());
    expect(screen.getByText('$500.00')).toBeInTheDocument();
    expect(screen.getByText('PENDING_APPROVAL')).toBeInTheDocument();
  });

  it('opens review modal and approves', async () => {
    const user = userEvent.setup();
    vi.mocked(apInvoiceApi.list).mockResolvedValue({ items: [PENDING_INVOICE], total: 1, page: 1, pageSize: 100 });
    vi.mocked(invoiceApprovalApi.getInstance).mockResolvedValue(APPROVAL_INSTANCE);
    vi.mocked(invoiceApprovalApi.approve).mockResolvedValue({ id: 'inst-1', status: 'APPROVED', steps: [] });
    renderPage();
    await waitFor(() => expect(screen.getByText('INV-100')).toBeInTheDocument());
    await user.click(screen.getByText('Review'));
    await waitFor(() => expect(screen.getByText(/Invoice INV-100/i)).toBeInTheDocument());
    const approveBtn = screen.getByRole('button', { name: /Approve/i });
    await user.click(approveBtn);
    await waitFor(() => expect(invoiceApprovalApi.approve).toHaveBeenCalledWith('inv-1', { version: 2 }));
  });

  it('shows self-approval warning when current user is submitter', async () => {
    const user = userEvent.setup();
    localStorage.setItem('goldenpath.user', JSON.stringify({ id: 'user-other' }));
    vi.mocked(apInvoiceApi.list).mockResolvedValue({ items: [PENDING_INVOICE], total: 1, page: 1, pageSize: 100 });
    vi.mocked(invoiceApprovalApi.getInstance).mockResolvedValue(APPROVAL_INSTANCE);
    renderPage();
    await waitFor(() => expect(screen.getByText('INV-100')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Review/i }));
    await waitFor(() => expect(screen.getByText(/Self-approval not permitted/i)).toBeInTheDocument());
  });

  it('shows inline unauthorized error on 403 from approve()', async () => {
    const user = userEvent.setup();
    vi.mocked(apInvoiceApi.list).mockResolvedValue({ items: [PENDING_INVOICE], total: 1, page: 1, pageSize: 100 });
    vi.mocked(invoiceApprovalApi.getInstance).mockResolvedValue(APPROVAL_INSTANCE);
    vi.mocked(invoiceApprovalApi.approve).mockRejectedValue(apiError(403, { message: 'Self-approval forbidden' }));
    renderPage();
    await waitFor(() => expect(screen.getByText('INV-100')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Review/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument());
  });
});

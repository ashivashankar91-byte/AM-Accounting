/**
 * S036A/S039 — PurchaseOrders2 UI smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PurchaseOrders2 from './PurchaseOrders2';
import { apPurchaseOrderApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  apPurchaseOrderApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    submit: vi.fn(),
    approve: vi.fn(),
    cancel: vi.fn(),
    void: vi.fn(),
    close: vi.fn(),
  },
}));

function renderPage(initialPath = '/pos2') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/pos2" element={<PurchaseOrders2 />} />
          <Route path="/pos2/:id" element={<PurchaseOrders2 />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const PO = { id: 'po-1', poNumber: 'PO-001', poType: 'GENERAL', vendorId: 'v-1', vendorName: 'Acme Corp', department: 'Parts', totalAmount: '800.00', status: 'DRAFT', lines: [] };

describe('PurchaseOrders2 list', () => {
  it('shows loading state', () => {
    (apPurchaseOrderApi.list as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading Purchase Orders/i)).toBeInTheDocument();
  });

  it('shows empty state when no POs', async () => {
    (apPurchaseOrderApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No purchase orders yet/i)).toBeInTheDocument());
  });

  it('shows error state with retry when list fails', async () => {
    (apPurchaseOrderApi.list as any).mockRejectedValue(new Error('apar-service unreachable'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('renders PO rows when loaded', async () => {
    (apPurchaseOrderApi.list as any).mockResolvedValue([PO]);
    renderPage();
    await waitFor(() => expect(screen.getByText('PO-001')).toBeInTheDocument());
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Parts')).toBeInTheDocument();
  });
});

describe('PurchaseOrders2 detail', () => {
  it('renders PO detail with Submit action for DRAFT', async () => {
    (apPurchaseOrderApi.getById as any).mockResolvedValue(PO);
    renderPage('/pos2/po-1');
    await waitFor(() => expect(screen.getByText(/PO-001/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Submit/i })).toBeInTheDocument();
  });

  it('shows unauthorized message for 403 errors', async () => {
    const err: any = new Error('Forbidden');
    err.status = 403;
    (apPurchaseOrderApi.getById as any).mockRejectedValue(err);
    renderPage('/pos2/po-1');
    await waitFor(() => expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument());
  });

  it('calls submit on DRAFT PO', async () => {
    (apPurchaseOrderApi.getById as any).mockResolvedValue(PO);
    (apPurchaseOrderApi.submit as any).mockResolvedValue({ ...PO, status: 'SUBMITTED' });
    const user = userEvent.setup();
    renderPage('/pos2/po-1');
    await waitFor(() => screen.getByRole('button', { name: /Submit/i }));
    await user.click(screen.getByRole('button', { name: /Submit/i }));
    await waitFor(() => expect(apPurchaseOrderApi.submit).toHaveBeenCalledWith('po-1'));
  });
});

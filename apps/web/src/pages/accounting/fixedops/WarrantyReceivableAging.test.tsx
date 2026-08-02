/**
 * CE-11 / S065 — Warranty Receivable & Claim Aging UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WarrantyReceivableAging from './WarrantyReceivableAging';
import { fixedopsApi } from '../../../api/fixedopsApi';

vi.mock('../../../api/fixedopsApi', () => ({
  fixedopsApi: {
    warrantyAging: vi.fn(),
    listWarrantyClaims: vi.fn(),
    submitWarrantyClaim: vi.fn(),
    dispositionWarrantyClaim: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/accounting/fixedops/warranty']}>
        <WarrantyReceivableAging />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const CLAIM = {
  id: 'c1', roNumber: 'RO-3001', claimNumber: 'CLM-1', saleAmount: '400.00', remainingAmount: '400.00',
  status: 'SUBMITTED', factoryAgeBand: '0-30', scheduleProjectionPending: true, submittedAt: '2026-07-01T00:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z',
};

describe('WarrantyReceivableAging', () => {
  it('renders claim rows and factory age-band totals', async () => {
    (fixedopsApi.warrantyAging as any).mockResolvedValue({ rows: [{ ...CLAIM, ageDays: 5 }], totalRemaining: 400 });
    (fixedopsApi.listWarrantyClaims as any).mockResolvedValue({ items: [CLAIM] });
    renderPage();
    expect(await screen.findByTestId('warranty-claims-table')).toBeInTheDocument();
    expect(screen.getByTestId('warranty-age-bands')).toHaveTextContent('0-30');
    expect(screen.getByText('CLM-1')).toBeInTheDocument();
  });

  it('shows the empty state when there are no warranty claims', async () => {
    (fixedopsApi.warrantyAging as any).mockResolvedValue({ rows: [], totalRemaining: 0 });
    (fixedopsApi.listWarrantyClaims as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('warranty-empty')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('no permission'); err.status = 401;
    (fixedopsApi.warrantyAging as any).mockRejectedValue(err);
    (fixedopsApi.listWarrantyClaims as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('warranty-unauthorized')).toBeInTheDocument();
  });

  it('disposition drawer requires a reason before it will submit', async () => {
    const user = userEvent.setup();
    (fixedopsApi.warrantyAging as any).mockResolvedValue({ rows: [{ ...CLAIM, ageDays: 5 }], totalRemaining: 400 });
    (fixedopsApi.listWarrantyClaims as any).mockResolvedValue({ items: [CLAIM] });
    renderPage();
    await screen.findByTestId('warranty-claims-table');

    await user.click(screen.getByTestId('warranty-disposition-open-CLM-1'));
    expect(screen.getByTestId('warranty-disposition-drawer')).toBeInTheDocument();
    await user.click(screen.getByTestId('warranty-disposition-submit'));

    expect(screen.getByText(/reason is required/)).toBeInTheDocument();
    expect(fixedopsApi.dispositionWarrantyClaim).not.toHaveBeenCalled();
  });

  it('disposition submits with a reason and conserves the remaining amount context', async () => {
    const user = userEvent.setup();
    (fixedopsApi.warrantyAging as any).mockResolvedValue({ rows: [{ ...CLAIM, ageDays: 5 }], totalRemaining: 400 });
    (fixedopsApi.listWarrantyClaims as any).mockResolvedValue({ items: [CLAIM] });
    (fixedopsApi.dispositionWarrantyClaim as any).mockResolvedValue({ id: 'd1' });
    renderPage();
    await screen.findByTestId('warranty-claims-table');

    await user.click(screen.getByTestId('warranty-disposition-open-CLM-1'));
    await user.type(screen.getByTestId('warranty-disposition-reason'), 'Factory short-paid $50');
    await user.click(screen.getByTestId('warranty-disposition-submit'));

    await waitFor(() => expect(fixedopsApi.dispositionWarrantyClaim).toHaveBeenCalledWith('CLM-1', expect.objectContaining({ reason: 'Factory short-paid $50' })));
  });

  it('submit action calls submitWarrantyClaim for a BORN claim', async () => {
    const user = userEvent.setup();
    const born = { ...CLAIM, status: 'BORN' };
    (fixedopsApi.warrantyAging as any).mockResolvedValue({ rows: [{ ...born, ageDays: 1 }], totalRemaining: 400 });
    (fixedopsApi.listWarrantyClaims as any).mockResolvedValue({ items: [born] });
    (fixedopsApi.submitWarrantyClaim as any).mockResolvedValue({ ...born, status: 'SUBMITTED' });
    renderPage();
    await screen.findByTestId('warranty-claims-table');

    await user.click(screen.getByTestId('warranty-submit-CLM-1'));
    await waitFor(() => expect(fixedopsApi.submitWarrantyClaim).toHaveBeenCalledWith('CLM-1'));
  });
});

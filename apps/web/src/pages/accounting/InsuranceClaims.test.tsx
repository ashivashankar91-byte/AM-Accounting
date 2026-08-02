/**
 * AMACC S047 — InsuranceClaims smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InsuranceClaims from './InsuranceClaims';
import { insuranceClaimApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  insuranceClaimApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    postSupplement: vi.fn(),
    applyPayment: vi.fn(),
    disposeShortPay: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InsuranceClaims />
    </QueryClientProvider>,
  );
}

const CLAIM = {
  id: 'claim-1',
  customerId: 'cust-1',
  insurerName: 'Progressive Insurance',
  insurerReference: 'POL-123',
  claimNumber: 'CLM-20240001',
  roReference: 'RO-12345',
  claimAmount: '4500.00',
  paidAmount: '0.00',
  status: 'OPEN',
  supplements: [],
  payments: [],
  createdAt: '2026-07-01T10:00:00Z',
};

describe('InsuranceClaims list', () => {
  it('shows loading state initially', () => {
    (insuranceClaimApi.list as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading Insurance Claims/i)).toBeInTheDocument();
  });

  it('shows empty state when no claims exist', async () => {
    (insuranceClaimApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No insurance claims/i)).toBeInTheDocument());
  });

  it('shows error state with retry', async () => {
    (insuranceClaimApi.list as any).mockRejectedValue(new Error('service down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows unauthorized message for 403', async () => {
    const err: any = new Error('Forbidden');
    err.status = 403;
    (insuranceClaimApi.list as any).mockRejectedValue(err);
    renderPage();
    await waitFor(() => expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument());
  });

  it('renders claim rows', async () => {
    (insuranceClaimApi.list as any).mockResolvedValue([CLAIM]);
    renderPage();
    await waitFor(() => expect(screen.getByText('CLM-20240001')).toBeInTheDocument());
    expect(screen.getByText('Progressive Insurance')).toBeInTheDocument();
  });
});

describe('InsuranceClaims detail actions', () => {
  it('opens detail panel and shows supplement form', async () => {
    const user = userEvent.setup();
    (insuranceClaimApi.list as any).mockResolvedValue([CLAIM]);
    (insuranceClaimApi.getById as any).mockResolvedValue(CLAIM);
    renderPage();

    await waitFor(() => expect(screen.getByText('CLM-20240001')).toBeInTheDocument());
    await user.click(screen.getByText('CLM-20240001'));
    await waitFor(() => expect(screen.getByText(/Claim Detail/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Post Supplement/i }));
    await waitFor(() => expect(screen.getByPlaceholderText(/-100\.00 or 250\.00/i)).toBeInTheDocument());
  });

  it('posts a supplement with adjustmentAmount and reason', async () => {
    const user = userEvent.setup();
    (insuranceClaimApi.list as any).mockResolvedValue([CLAIM]);
    (insuranceClaimApi.getById as any).mockResolvedValue(CLAIM);
    (insuranceClaimApi.postSupplement as any).mockResolvedValue({ ...CLAIM, supplements: [{ id: 's-1', adjustmentAmount: 200, reason: 'Additional damage' }] });
    renderPage();

    await waitFor(() => expect(screen.getByText('CLM-20240001')).toBeInTheDocument());
    await user.click(screen.getByText('CLM-20240001'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Post Supplement/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Post Supplement/i }));

    await user.type(screen.getByPlaceholderText(/-100\.00 or 250\.00/i), '200');
    await user.type(screen.getByDisplayValue(''), 'Additional damage');
    await user.click(screen.getAllByRole('button', { name: /^Post$/i })[0]);

    await waitFor(() => expect(insuranceClaimApi.postSupplement).toHaveBeenCalledWith('claim-1', {
      adjustmentAmount: 200,
      reason: 'Additional damage',
    }));
  });

  it('applies a payment', async () => {
    const user = userEvent.setup();
    (insuranceClaimApi.list as any).mockResolvedValue([CLAIM]);
    (insuranceClaimApi.getById as any).mockResolvedValue(CLAIM);
    (insuranceClaimApi.applyPayment as any).mockResolvedValue({ ...CLAIM, paidAmount: '4500.00', status: 'CLOSED' });
    renderPage();

    await waitFor(() => expect(screen.getByText('CLM-20240001')).toBeInTheDocument());
    await user.click(screen.getByText('CLM-20240001'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Apply Payment/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Apply Payment/i }));

    await user.type(screen.getByRole('spinbutton'), '4500');
    await user.click(screen.getByRole('button', { name: /^Apply$/i }));
    await waitFor(() => expect(insuranceClaimApi.applyPayment).toHaveBeenCalledWith('claim-1', { amount: 4500 }));
  });
});

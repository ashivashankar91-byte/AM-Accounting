import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VendorInsuranceCertificates from './VendorInsuranceCertificates';
import { aparApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  aparApi: {
    getVendorInsuranceCertificates: vi.fn(),
    getInsuranceCertificate: vi.fn(),
    createInsuranceCertificate: vi.fn(),
    updateInsuranceCertificate: vi.fn(),
    renewInsuranceCertificate: vi.fn(),
    revokeInsuranceCertificate: vi.fn(),
    getInsuranceCertificateAuditEvents: vi.fn(),
    getVendorInsuranceSummary: vi.fn(),
    getVendorEligibility: vi.fn(),
  },
}));

function renderPage(vendorId = 'v-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <VendorInsuranceCertificates vendorId={vendorId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const CERT = {
  id: 'cert-1',
  certificateNumber: 'CERT-001',
  insuranceProvider: 'Acme Insurance',
  insuranceType: 'GENERAL_LIABILITY',
  effectiveDate: '2026-01-01',
  expirationDate: '2027-01-01',
  coverageAmount: 1000000,
  status: 'ACTIVE',
  expirationStatus: 'CURRENT',
  version: 1,
};

beforeEach(() => {
  vi.mocked(aparApi.getVendorInsuranceCertificates).mockReset();
  vi.mocked(aparApi.getVendorInsuranceSummary).mockReset();
  vi.mocked(aparApi.getVendorEligibility).mockReset();
  vi.mocked(aparApi.createInsuranceCertificate).mockReset();
});

describe('VendorInsuranceCertificates', () => {
  it('shows loading state', () => {
    vi.mocked(aparApi.getVendorInsuranceCertificates).mockReturnValue(new Promise(() => {}));
    vi.mocked(aparApi.getVendorInsuranceSummary).mockResolvedValue({});
    vi.mocked(aparApi.getVendorEligibility).mockResolvedValue({ eligible: true, status: 'ACTIVE', reason: null });
    renderPage();
    expect(screen.getByTestId('vendor-insurance-section')).toBeInTheDocument();
  });

  it('shows empty state when no certificates', async () => {
    vi.mocked(aparApi.getVendorInsuranceCertificates).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(aparApi.getVendorInsuranceSummary).mockResolvedValue({});
    vi.mocked(aparApi.getVendorEligibility).mockResolvedValue({ eligible: true, status: 'ACTIVE', reason: null });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No insurance certificates/i)).toBeInTheDocument());
  });

  it('renders certificate rows when loaded', async () => {
    vi.mocked(aparApi.getVendorInsuranceCertificates).mockResolvedValue({ items: [CERT], total: 1 });
    vi.mocked(aparApi.getVendorInsuranceSummary).mockResolvedValue({});
    vi.mocked(aparApi.getVendorEligibility).mockResolvedValue({ eligible: true, status: 'ACTIVE', reason: null });
    renderPage();
    await waitFor(() => expect(screen.getByText('CERT-001')).toBeInTheDocument());
    expect(screen.getByText('Acme Insurance')).toBeInTheDocument();
  });

  it('shows payment freeze banner when vendor is not eligible', async () => {
    vi.mocked(aparApi.getVendorInsuranceCertificates).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(aparApi.getVendorInsuranceSummary).mockResolvedValue({});
    vi.mocked(aparApi.getVendorEligibility).mockResolvedValue({
      eligible: false,
      status: 'PAYMENT_HOLD',
      reason: 'Insurance expired',
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/Payments Frozen/i)).toBeInTheDocument());
    expect(screen.getByText(/Insurance expired/i)).toBeInTheDocument();
  });

  it('creates a new certificate', async () => {
    const user = userEvent.setup();
    vi.mocked(aparApi.getVendorInsuranceCertificates).mockResolvedValue({ items: [], total: 0 });
    vi.mocked(aparApi.getVendorInsuranceSummary).mockResolvedValue({});
    vi.mocked(aparApi.getVendorEligibility).mockResolvedValue({ eligible: true, status: 'ACTIVE', reason: null });
    vi.mocked(aparApi.createInsuranceCertificate).mockResolvedValue(CERT);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No insurance certificates/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add Certificate/i }));
    // The modal should be open
    await waitFor(() => expect(screen.getByText('Add Insurance Certificate')).toBeInTheDocument());
    await waitFor(() => expect(aparApi.createInsuranceCertificate).not.toHaveBeenCalled());
  });
});

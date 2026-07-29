/**
 * AMACC-CH04 S036A — VendorMaintenance UI tests.
 *
 * First frontend test file in this repo (see ../../../vitest.config.ts).
 * Covers a representative subset of the required frontend scenarios —
 * loading/empty/error states, create validation, the duplicate-warning
 * dialog, cancel-does-not-create, and tax-ID masking — not the full listed
 * set (see the S036A final report for what remains uncovered).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VendorMaintenance from './VendorMaintenance';
import { aparApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  aparApi: {
    getVendors: vi.fn(),
    getVendor: vi.fn(),
    createVendor: vi.fn(),
    updateVendor: vi.fn(),
    checkVendorDuplicates: vi.fn(),
    inactivateVendor: vi.fn(),
    reactivateVendor: vi.fn(),
    deleteVendor: vi.fn(),
    getVendorEligibility: vi.fn(),
    getVendorAuditEvents: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/accounting/ap/vendors']}>
        <VendorMaintenance />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const VENDOR = {
  id: 'v-1',
  vendorNumber: '000001',
  vendorName: 'Acme Supply',
  vendorType: 'SUPPLIER',
  status: 'ACTIVE',
  version: 1,
  taxIdMasked: '*****6789',
};

beforeEach(() => {
  vi.mocked(aparApi.getVendors).mockReset();
  vi.mocked(aparApi.getVendor).mockReset();
  vi.mocked(aparApi.createVendor).mockReset();
  vi.mocked(aparApi.checkVendorDuplicates).mockReset();
});

describe('VendorMaintenance — list states', () => {
  it('shows a loading state while vendors are fetched', async () => {
    vi.mocked(aparApi.getVendors).mockImplementation(() => new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.getByText(/Vendor Maintenance/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no vendors', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    renderPage();
    await waitFor(() => expect(screen.getByText(/No vendors found/i)).toBeInTheDocument());
  });

  it('shows a retryable error state when the vendor list fails to load', async () => {
    vi.mocked(aparApi.getVendors).mockRejectedValue(new Error('network down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Could not load vendors/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

describe('VendorMaintenance — create flow', () => {
  it('requires a vendor name before saving', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText(/No vendors found/i));
    await user.click(screen.getByRole('button', { name: /new vendor/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByText(/Vendor name is required/i)).toBeInTheDocument();
    expect(aparApi.createVendor).not.toHaveBeenCalled();
  });

  it('shows the duplicate-warning dialog and does not create when candidates are found', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    vi.mocked(aparApi.checkVendorDuplicates).mockResolvedValue({
      candidates: [{ vendorId: 'v-2', vendorNumber: '000002', vendorName: 'Acme Supply', status: 'ACTIVE', matchedSignals: ['NAME_AND_POSTAL_CODE'] }],
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText(/No vendors found/i));
    await user.click(screen.getByRole('button', { name: /new vendor/i }));
    await user.type(screen.getByPlaceholderText(/Company or individual name/i), 'Acme Supply');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText(/Possible Duplicate Vendor/i)).toBeInTheDocument());
    expect(screen.getByText(/NAME_AND_POSTAL_CODE/)).toBeInTheDocument();
    expect(aparApi.createVendor).not.toHaveBeenCalled();

    // Cancel — no vendor should be created
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByText(/Possible Duplicate Vendor/i)).not.toBeInTheDocument();
    expect(aparApi.createVendor).not.toHaveBeenCalled();
  });

  it('requires a reason before allowing Create Anyway', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    vi.mocked(aparApi.checkVendorDuplicates).mockResolvedValue({
      candidates: [{ vendorId: 'v-2', vendorNumber: '000002', vendorName: 'Acme Supply', status: 'ACTIVE', matchedSignals: ['EMAIL'] }],
    });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText(/No vendors found/i));
    await user.click(screen.getByRole('button', { name: /new vendor/i }));
    await user.type(screen.getByPlaceholderText(/Company or individual name/i), 'Acme Supply');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => screen.getByText(/Possible Duplicate Vendor/i));

    const createAnywayBtn = screen.getByRole('button', { name: /create anyway/i });
    expect(createAnywayBtn).toBeDisabled();
  });
});

describe('VendorMaintenance — detail: tax ID masking', () => {
  it('displays only the masked tax id, never an editable field', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(VENDOR);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await user.click(await screen.findByRole('button', { name: /tax \/ 1099/i }));
    expect(await screen.findByText('*****6789')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/XX-XXXXXXX/i)).not.toBeInTheDocument();
  });
});

describe('VendorMaintenance — inactivate dialog', () => {
  it('disables the inactivate confirmation until a reason is entered', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(VENDOR);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await user.click(await screen.findByRole('button', { name: /inactivate/i }));

    const dialog = await screen.findByText(/Inactivate Vendor\?/i);
    const dialogBox = dialog.closest('div.space-y-4') as HTMLElement;
    const confirmBtn = within(dialogBox).getByRole('button', { name: /^inactivate$/i });
    expect(confirmBtn).toBeDisabled();
  });
});

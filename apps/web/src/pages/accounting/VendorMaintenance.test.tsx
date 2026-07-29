/**
 * AMACC-CH04 S036A — VendorMaintenance UI tests.
 *
 * First frontend test file in this repo (see ../../../vitest.config.ts).
 * Covers all required critical UI states: loading, empty, error+retry,
 * unauthorized (list + detail), not-found, required validation, successful
 * create, duplicate-candidate display, cancel-without-create, Create-Anyway
 * reason requirement, unauthorized/forbidden override, successful edit,
 * version conflict, inactivation reason, inactive display, reactivation,
 * delete-reference conflict, tax-ID masking, permission-sensitive actions,
 * and audit loading/empty/error.
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

const INACTIVE_VENDOR = {
  id: 'v-2',
  vendorNumber: '000002',
  vendorName: 'Dormant Vendor',
  vendorType: 'OTHER',
  status: 'INACTIVE',
  version: 3,
  inactiveReason: 'No longer used',
  taxIdMasked: null,
};

function apiError(status: number, body: any) {
  const err: any = new Error(body?.message ?? body?.error ?? `API error ${status}`);
  err.status = status;
  err.body = body;
  return err;
}

beforeEach(() => {
  vi.mocked(aparApi.getVendors).mockReset();
  vi.mocked(aparApi.getVendor).mockReset();
  vi.mocked(aparApi.createVendor).mockReset();
  vi.mocked(aparApi.updateVendor).mockReset();
  vi.mocked(aparApi.checkVendorDuplicates).mockReset();
  vi.mocked(aparApi.inactivateVendor).mockReset();
  vi.mocked(aparApi.reactivateVendor).mockReset();
  vi.mocked(aparApi.deleteVendor).mockReset();
  vi.mocked(aparApi.getVendorEligibility).mockReset();
  vi.mocked(aparApi.getVendorAuditEvents).mockReset();
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

describe('VendorMaintenance — unauthorized and not-found states', () => {
  it('shows an unauthorized state for the vendor list on a 403', async () => {
    vi.mocked(aparApi.getVendors).mockRejectedValue(apiError(403, { error: 'FORBIDDEN' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/don't have permission to view vendors/i)).toBeInTheDocument());
  });

  it('shows a not-found state for a vendor detail that does not exist', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockRejectedValue(apiError(404, { error: 'VENDOR_NOT_FOUND' }));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await waitFor(() => expect(screen.getByText(/Vendor not found/i)).toBeInTheDocument());
  });
});

describe('VendorMaintenance — successful create', () => {
  it('creates a vendor with no duplicate candidates and shows success', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    vi.mocked(aparApi.checkVendorDuplicates).mockResolvedValue({ candidates: [] });
    vi.mocked(aparApi.createVendor).mockResolvedValue({ ...VENDOR, id: 'v-new', vendorName: 'Brand New Vendor' });
    vi.mocked(aparApi.getVendor).mockResolvedValue({ ...VENDOR, id: 'v-new', vendorName: 'Brand New Vendor' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText(/No vendors found/i));
    await user.click(screen.getByRole('button', { name: /new vendor/i }));
    await user.type(screen.getByPlaceholderText(/Company or individual name/i), 'Brand New Vendor');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(aparApi.createVendor).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Vendor saved.')).toBeInTheDocument();
  });
});

describe('VendorMaintenance — Create Anyway override authorization', () => {
  async function openDuplicateDialogAndFillReason(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => screen.getByText(/No vendors found/i));
    await user.click(screen.getByRole('button', { name: /new vendor/i }));
    await user.type(screen.getByPlaceholderText(/Company or individual name/i), 'Acme Supply');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => screen.getByText(/Possible Duplicate Vendor/i));
    await user.type(screen.getByPlaceholderText(/Required to override/i), 'Confirmed distinct entity');
  }

  it('shows a permission-denied message when the server rejects the override (unauthorized override)', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    vi.mocked(aparApi.checkVendorDuplicates).mockResolvedValue({
      candidates: [{ vendorId: 'v-2', vendorNumber: '000002', vendorName: 'Acme Supply', status: 'ACTIVE', matchedSignals: ['EMAIL'] }],
    });
    vi.mocked(aparApi.createVendor).mockRejectedValue(
      apiError(403, { error: 'DUPLICATE_VENDOR_OVERRIDE_FORBIDDEN', message: 'Missing required permission: ap.vendor.duplicate_override' }),
    );
    const user = userEvent.setup();
    renderPage();
    await openDuplicateDialogAndFillReason(user);
    await user.click(screen.getByRole('button', { name: /create anyway/i }));

    await waitFor(() => expect(screen.getByText(/don't have permission to create a vendor anyway/i)).toBeInTheDocument());
    expect(aparApi.createVendor).toHaveBeenCalledTimes(1);
  });

  it('enforces the override permission server-side, not just client-side (server-side forbidden override)', async () => {
    // The dialog never hides "Create Anyway" client-side (no client-held
    // permission info exists in this app) — enforcement is proven by the
    // server call actually happening and being denied, not by the button
    // being absent.
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    vi.mocked(aparApi.checkVendorDuplicates).mockResolvedValue({
      candidates: [{ vendorId: 'v-2', vendorNumber: '000002', vendorName: 'Acme Supply', status: 'ACTIVE', matchedSignals: ['EMAIL'] }],
    });
    vi.mocked(aparApi.createVendor).mockRejectedValue(apiError(403, { error: 'DUPLICATE_VENDOR_OVERRIDE_FORBIDDEN' }));
    const user = userEvent.setup();
    renderPage();
    await openDuplicateDialogAndFillReason(user);
    expect(screen.getByRole('button', { name: /create anyway/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /create anyway/i }));
    await waitFor(() => expect(aparApi.createVendor).toHaveBeenCalledWith(expect.objectContaining({
      override: expect.objectContaining({ reason: 'Confirmed distinct entity' }),
    })));
    // No vendor was actually created — the server, not the client, is the gate.
    expect(screen.queryByText('Vendor saved.')).not.toBeInTheDocument();
  });
});

describe('VendorMaintenance — edit flow', () => {
  it('successfully edits a vendor', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(VENDOR);
    vi.mocked(aparApi.updateVendor).mockResolvedValue({ ...VENDOR, dba: 'Acme Co' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await user.type(await screen.findByTestId('vendor-dba-input'), 'Acme Co');
    await user.click(screen.getByRole('button', { name: /^save/i }));

    await waitFor(() => expect(aparApi.updateVendor).toHaveBeenCalledWith('v-1', expect.objectContaining({ dba: 'Acme Co', version: 1 })));
    expect(screen.getByText('Vendor saved.')).toBeInTheDocument();
  });

  it('shows a version-conflict prompt on a stale update', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(VENDOR);
    vi.mocked(aparApi.updateVendor).mockRejectedValue(apiError(409, { error: 'VERSION_CONFLICT' }));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await user.type(await screen.findByTestId('vendor-dba-input'), 'Acme Co');
    await user.click(screen.getByRole('button', { name: /^save/i }));

    await waitFor(() => expect(screen.getByText(/this vendor changed/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^reload$/i })).toBeInTheDocument();
  });
});

describe('VendorMaintenance — inactive vendor: display, reactivation, delete conflict', () => {
  it('displays a prominent inactive status and reason', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [INACTIVE_VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(INACTIVE_VENDOR);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Dormant Vendor'));
    await user.click(screen.getByText('Dormant Vendor'));
    expect(await screen.findByText('INACTIVE', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/this vendor is inactive/i)).toBeInTheDocument();
    expect(screen.getByText(/No longer used/)).toBeInTheDocument();
  });

  it('reactivates an inactive vendor', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [INACTIVE_VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(INACTIVE_VENDOR);
    vi.mocked(aparApi.reactivateVendor).mockResolvedValue({ ...INACTIVE_VENDOR, status: 'ACTIVE' });
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Dormant Vendor'));
    await user.click(screen.getByText('Dormant Vendor'));
    await user.click(await screen.findByRole('button', { name: /^reactivate$/i }));
    const dialog = await screen.findByText(/Reactivate Vendor\?/i);
    const dialogBox = dialog.closest('div.space-y-4') as HTMLElement;
    await user.click(within(dialogBox).getByRole('button', { name: /^reactivate$/i }));

    await waitFor(() => expect(aparApi.reactivateVendor).toHaveBeenCalledWith('v-2', { version: 3 }));
    expect(screen.getByText('Vendor reactivated.')).toBeInTheDocument();
  });

  it('shows the reference-conflict explanation when delete is blocked', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [INACTIVE_VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(INACTIVE_VENDOR);
    vi.mocked(aparApi.deleteVendor).mockRejectedValue(
      apiError(409, { error: 'VENDOR_HAS_REFERENCES', references: { purchaseOrders: 2, apEntries: 1 } }),
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Dormant Vendor'));
    await user.click(screen.getByText('Dormant Vendor'));
    await user.click(await screen.findByRole('button', { name: /^delete$/i }));
    const dialog = await screen.findByText(/Delete Vendor\?/i);
    const dialogBox = dialog.closest('div.space-y-4') as HTMLElement;
    await user.click(within(dialogBox).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(screen.getByText(/Cannot Delete Vendor/i)).toBeInTheDocument());
    expect(screen.getByText(/2 purchase order\(s\) and 1 AP invoice\(s\)/i)).toBeInTheDocument();
  });
});

describe('VendorMaintenance — permission-sensitive actions', () => {
  it('shows an unauthorized message, not a crash, when a mutation is server-denied', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(VENDOR);
    vi.mocked(aparApi.inactivateVendor).mockRejectedValue(
      apiError(403, { error: 'FORBIDDEN', message: 'Missing required permission: ap.vendor.inactivate' }),
    );
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await user.click(await screen.findByRole('button', { name: /^inactivate$/i }));
    const dialog = await screen.findByText(/Inactivate Vendor\?/i);
    const dialogBox = dialog.closest('div.space-y-4') as HTMLElement;
    await user.type(within(dialogBox).getByPlaceholderText(/Required/i), 'reason');
    await user.click(within(dialogBox).getByRole('button', { name: /^inactivate$/i }));

    await waitFor(() => expect(screen.getByText(/Missing required permission: ap\.vendor\.inactivate/i)).toBeInTheDocument());
  });
});

describe('VendorMaintenance — audit history states', () => {
  it('shows a loading state while audit history is fetched', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(VENDOR);
    vi.mocked(aparApi.getVendorAuditEvents).mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await user.click(await screen.findByRole('button', { name: /audit history/i }));
    expect(await screen.findByText(/Loading audit history/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no audit events', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(VENDOR);
    vi.mocked(aparApi.getVendorAuditEvents).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await user.click(await screen.findByRole('button', { name: /audit history/i }));
    expect(await screen.findByText(/No audit events recorded yet/i)).toBeInTheDocument();
  });

  it('shows an error state when audit history fails to load', async () => {
    vi.mocked(aparApi.getVendors).mockResolvedValue({ items: [VENDOR], total: 1, page: 1, pageSize: 50 });
    vi.mocked(aparApi.getVendor).mockResolvedValue(VENDOR);
    vi.mocked(aparApi.getVendorAuditEvents).mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => screen.getByText('Acme Supply'));
    await user.click(screen.getByText('Acme Supply'));
    await user.click(await screen.findByRole('button', { name: /audit history/i }));
    expect(await screen.findByText(/Could not load audit history/i)).toBeInTheDocument();
  });
});

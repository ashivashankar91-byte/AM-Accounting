/**
 * CE-11 / Integration-fix — Insurance Receivable Inquiry UI tests.
 * Phase 5 reconciliation: InsuranceReceivableInquiry is now wired to the real
 * CE-09 S049 insuranceClaimApi. Tests cover loading, empty, populated and
 * RO-filter states using a mocked API client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import InsuranceReceivableInquiry from './InsuranceReceivableInquiry';

// Mock the API module — real CE-09 insuranceClaimApi wired in production.
vi.mock('../../../api/client', () => ({
  insuranceClaimApi: {
    list: vi.fn(),
  },
}));

import { insuranceClaimApi } from '../../../api/client';
const mockList = insuranceClaimApi.list as ReturnType<typeof vi.fn>;

const SAMPLE_CLAIM = {
  id: 'claim-001',
  claimNumber: 'CLM-2026-001',
  roReference: 'RO-45678',
  insurerName: 'SafeAuto Insurance',
  insurerReference: 'SA-REF-9999',
  customerId: 'cust-1',
  claimAmount: 2500,
  effectiveClaimAmount: 2500,
  remainingBalance: 1800,
  status: 'PARTIALLY_PAID',
  glEntryId: 'je-001',
  glPostingError: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/fixedops/insurance']}>
      <InsuranceReceivableInquiry />
    </MemoryRouter>,
  );
}

describe('InsuranceReceivableInquiry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while the API is in flight', () => {
    mockList.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.getByTestId('insurance-loading')).toBeInTheDocument();
  });

  it('shows a truthful empty state (no PUTR banner) when the API returns no claims', async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.queryByTestId('insurance-loading')).not.toBeInTheDocument());
    expect(screen.getByTestId('insurance-empty')).toBeInTheDocument();
    // PENDING_UPSTREAM_TECHNICAL_RECONCILIATION banner must be gone
    expect(screen.queryByTestId('insurance-putr-banner')).not.toBeInTheDocument();
    expect(screen.queryByText(/PENDING_UPSTREAM_TECHNICAL_RECONCILIATION/)).not.toBeInTheDocument();
  });

  it('renders claim rows when the API returns insurance claims', async () => {
    mockList.mockResolvedValue([SAMPLE_CLAIM]);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('insurance-claim-row')).toHaveLength(1));
    expect(screen.getByText('CLM-2026-001')).toBeInTheDocument();
    expect(screen.getByText('RO-45678')).toBeInTheDocument();
    expect(screen.getByText(/SafeAuto Insurance/)).toBeInTheDocument();
    expect(screen.queryByTestId('insurance-empty')).not.toBeInTheDocument();
  });

  it('filters claims by RO reference when the filter is populated', async () => {
    const otherClaim = { ...SAMPLE_CLAIM, id: 'c2', claimNumber: 'CLM-2026-002', roReference: 'RO-99999' };
    mockList.mockResolvedValue([SAMPLE_CLAIM, otherClaim]);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('insurance-claim-row')).toHaveLength(2));

    const filter = screen.getByTestId('insurance-ro-filter');
    await userEvent.type(filter, 'RO-45678');
    expect(screen.getAllByTestId('insurance-claim-row')).toHaveLength(1);
    expect(screen.getByText('CLM-2026-001')).toBeInTheDocument();
    expect(screen.queryByText('CLM-2026-002')).not.toBeInTheDocument();
  });

  it('shows an error state when the API fails', async () => {
    mockList.mockRejectedValue(new Error('Network error'));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('insurance-error')).toBeInTheDocument());
    expect(screen.getByTestId('insurance-error')).toHaveTextContent('Network error');
  });

  it('renders the RO-reference filter input', async () => {
    mockList.mockResolvedValue([]);
    renderPage();
    expect(screen.getByTestId('insurance-ro-filter')).toBeInTheDocument();
  });

  it('renders journal entry ID and GL error indicator when present', async () => {
    const claimWithGlError = { ...SAMPLE_CLAIM, glPostingError: 'ACCOUNT_MAPPING_VALUES_PENDING', glEntryId: null };
    mockList.mockResolvedValue([claimWithGlError]);
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('insurance-claim-row')).toHaveLength(1));
    expect(screen.getByTestId('insurance-gl-error')).toBeInTheDocument();
  });
});

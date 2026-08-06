/**
 * ContractorReports1099.test.tsx — smoke tests for the extended 1099 admin component.
 * Covers the new box-rules, threshold-configs, corrections, and year-preview tabs.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ContractorReports1099 from './ContractorReports1099';
import { vendor1099AdminApi, glApi } from '../api/client';

vi.mock('../api/client', () => ({
  glApi: {
    list1099Records: vi.fn(),
    generate1099Forms: vi.fn(),
    export1099Forms: vi.fn(),
  },
  vendor1099AdminApi: {
    setBoxRule: vi.fn(),
    getBoxRules: vi.fn(),
    setThresholdConfig: vi.fn(),
    getThresholdConfigs: vi.fn(),
    postCorrection: vi.fn(),
    getCorrections: vi.fn(),
    getYearPreview: vi.fn(),
  },
}));

function renderComponent() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ContractorReports1099 />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContractorReports1099 — existing review tab', () => {
  it('renders review tab with records', async () => {
    (glApi.list1099Records as any).mockResolvedValue([
      { id: 'r-1', vendorId: 'v-1', vendorName: 'Acme LLC', taxYear: 2025, formType: '1099-NEC', totalPayments: 1200, status: 'DRAFT', boxAmounts: { '1': 1200 }, createdAt: '2026-01-01' },
    ]);
    renderComponent();
    await waitFor(() => expect(screen.getByText('Acme LLC')).toBeInTheDocument());
  });

  it('shows error when records fail to load', async () => {
    (glApi.list1099Records as any).mockRejectedValue(new Error('Service error'));
    renderComponent();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
  });
});

describe('ContractorReports1099 — box-rules tab', () => {
  it('renders box rules tab and shows empty state', async () => {
    const user = userEvent.setup();
    (glApi.list1099Records as any).mockResolvedValue([]);
    (vendor1099AdminApi.getBoxRules as any).mockResolvedValue([]);
    renderComponent();

    await user.click(screen.getByRole('button', { name: /Box Rules/i }));
    await waitFor(() => expect(screen.getByText(/No box rules configured/i)).toBeInTheDocument());
  });

  it('calls setBoxRule when form is submitted', async () => {
    const user = userEvent.setup();
    (glApi.list1099Records as any).mockResolvedValue([]);
    (vendor1099AdminApi.getBoxRules as any).mockResolvedValue([]);
    (vendor1099AdminApi.setBoxRule as any).mockResolvedValue({ id: 'rule-1' });
    renderComponent();

    await user.click(screen.getByRole('button', { name: /Box Rules/i }));
    // Wait for the box-rules panel to render
    await waitFor(() => expect(screen.getAllByText(/Set Box Rule/i).length).toBeGreaterThan(0));

    // Fill vendorId (first text input in the form)
    const textInputs = screen.getAllByRole('textbox');
    await user.type(textInputs[0], 'vendor-001');

    // Box code input has placeholder "e.g. 1"
    const boxCodeInput = screen.getByPlaceholderText(/e\.g\. 1/i);
    await user.type(boxCodeInput, '1');

    // Click the <button> element specifically (not the <p> heading)
    const setBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.trim() === 'Set Box Rule',
    );
    expect(setBtn).toBeTruthy();
    await user.click(setBtn!);
    await waitFor(() => expect(vendor1099AdminApi.setBoxRule).toHaveBeenCalled());
  });
});

describe('ContractorReports1099 — thresholds tab', () => {
  it('renders thresholds and lists existing configs', async () => {
    const user = userEvent.setup();
    (glApi.list1099Records as any).mockResolvedValue([]);
    (vendor1099AdminApi.getThresholdConfigs as any).mockResolvedValue([
      { id: 'tc-1', formType: '1099-NEC', taxYear: 2025, thresholdAmount: 600 },
    ]);
    renderComponent();

    await user.click(screen.getByRole('button', { name: /Thresholds/i }));
    // table should appear with the form type
    await waitFor(() => {
      const els = screen.getAllByText('1099-NEC');
      expect(els.length).toBeGreaterThan(0);
    });
  });
});

describe('ContractorReports1099 — corrections tab', () => {
  it('renders corrections tab empty state', async () => {
    const user = userEvent.setup();
    (glApi.list1099Records as any).mockResolvedValue([]);
    (vendor1099AdminApi.getCorrections as any).mockResolvedValue([]);
    renderComponent();

    await user.click(screen.getByRole('button', { name: /Corrections/i }));
    await waitFor(() => expect(screen.getByText(/No corrections found/i)).toBeInTheDocument());
  });
});

describe('ContractorReports1099 — year preview tab', () => {
  it('renders year preview tab with API data', async () => {
    const user = userEvent.setup();
    (glApi.list1099Records as any).mockResolvedValue([]);
    (vendor1099AdminApi.getYearPreview as any).mockResolvedValue({ totalVendors: 12, totalAmount: 48600, formsGenerated: 10 });
    renderComponent();

    await user.click(screen.getByRole('button', { name: /Year Preview/i }));
    await waitFor(() => expect(screen.getByText(/totalVendors/i)).toBeInTheDocument());
  });

  it('shows Unauthorized banner on 403 for year preview', async () => {
    const user = userEvent.setup();
    (glApi.list1099Records as any).mockResolvedValue([]);
    const err: any = new Error('Forbidden');
    err.status = 403;
    (vendor1099AdminApi.getYearPreview as any).mockRejectedValue(err);
    renderComponent();

    await user.click(screen.getByRole('button', { name: /Year Preview/i }));
    await waitFor(() => expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument());
  });
});

/**
 * BankReconSessions.test.tsx — S054A/S054B smoke tests.
 * Pattern: vitest + RTL + vi.mock (mirrors VendorInvoices.test.tsx)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BankReconSessions from './BankReconSessions';
import { reconSessionApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  reconSessionApi: {
    list: vi.fn(),
    create: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/accounting/bank-recon/sessions']}>
        <BankReconSessions />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SESSION = {
  id: 'sess-0001-0000-0000-000000000001',
  entityId: 'entity-001',
  bankAccountCode: 'CHK-001',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  statementBeginningBalance: '10000.00',
  statementEndingBalance: '12500.00',
  status: 'OPEN',
};

describe('BankReconSessions list', () => {
  it('renders loading state then session rows', async () => {
    (reconSessionApi.list as any).mockResolvedValue([SESSION]);
    renderPage();
    await waitFor(() => expect(screen.getByText('CHK-001')).toBeInTheDocument());
    expect(screen.getByText('entity-001')).toBeInTheDocument();
  });

  it('shows empty state when no sessions exist', async () => {
    (reconSessionApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No reconciliation sessions yet/i)).toBeInTheDocument());
  });

  it('shows error state with retry button on list failure', async () => {
    const err: any = new Error('recon-service unreachable');
    (reconSessionApi.list as any).mockRejectedValue(err);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows Unauthorized banner on 401', async () => {
    const err: any = new Error('Unauthorized');
    err.status = 401;
    (reconSessionApi.list as any).mockRejectedValue(err);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument());
  });

  it('opens create form and calls reconSessionApi.create', async () => {
    const user = userEvent.setup();
    (reconSessionApi.list as any).mockResolvedValue([]);
    (reconSessionApi.create as any).mockResolvedValue(SESSION);
    renderPage();

    await waitFor(() => expect(screen.getByText(/No reconciliation sessions yet/i)).toBeInTheDocument());

    // Click the New Session button in the header actions
    const newBtns = screen.getAllByRole('button', { name: /New Session/i });
    await user.click(newBtns[0]);

    await waitFor(() => expect(screen.getByText(/Create Reconciliation Session/i)).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('entity-001'), 'entity-001');
    await user.type(screen.getByPlaceholderText('CHK-001'), 'CHK-001');

    // date inputs by label vicinity
    const dateInputs = document.querySelectorAll('input[type="date"]');
    await user.type(dateInputs[0] as HTMLElement, '2026-07-01');
    await user.type(dateInputs[1] as HTMLElement, '2026-07-31');

    const numInputs = document.querySelectorAll('input[type="number"]');
    await user.type(numInputs[0] as HTMLElement, '10000');
    await user.type(numInputs[1] as HTMLElement, '12500');

    await user.click(screen.getByRole('button', { name: /Create Session/i }));
    await waitFor(() => expect(reconSessionApi.create).toHaveBeenCalled());
  });
});

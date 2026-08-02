import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UseTaxAssessments from './UseTaxAssessments';
import { useTaxApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  useTaxApi: {
    getAssessments: vi.fn(),
    getAssessment: vi.fn(),
    getRegister: vi.fn(),
    assessInvoice: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UseTaxAssessments />
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

const ASSESSMENT = {
  id: 'uta-1',
  invoiceId: 'inv-1',
  jurisdiction: 'CA',
  taxableAmount: 1000,
  taxAmount: 95,
  taxRate: 9.5,
  status: 'POSTED',
};

beforeEach(() => {
  vi.mocked(useTaxApi.getAssessments).mockReset();
  vi.mocked(useTaxApi.getAssessment).mockReset();
  vi.mocked(useTaxApi.getRegister).mockReset();
});

describe('UseTaxAssessments', () => {
  it('shows loading state', () => {
    vi.mocked(useTaxApi.getAssessments).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('shows empty state when no assessments', async () => {
    vi.mocked(useTaxApi.getAssessments).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No use-tax assessments/i)).toBeInTheDocument());
  });

  it('shows error state with retry', async () => {
    vi.mocked(useTaxApi.getAssessments).mockRejectedValue(new Error('Service unavailable'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows unauthorized state for 403', async () => {
    vi.mocked(useTaxApi.getAssessments).mockRejectedValue(apiError(403, { message: 'Forbidden' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument());
  });

  it('renders assessment rows when loaded', async () => {
    vi.mocked(useTaxApi.getAssessments).mockResolvedValue([ASSESSMENT]);
    renderPage();
    await waitFor(() => expect(screen.getByText('CA')).toBeInTheDocument());
    expect(screen.getByText('$1000.00')).toBeInTheDocument();
    expect(screen.getByText('$95.00')).toBeInTheDocument();
  });

  it('switches to register tab and loads register data', async () => {
    const user = userEvent.setup();
    vi.mocked(useTaxApi.getAssessments).mockResolvedValue([ASSESSMENT]);
    vi.mocked(useTaxApi.getRegister).mockResolvedValue([{ id: 'reg-1', period: '2026-06', jurisdiction: 'CA', taxableAmount: 5000, taxAmount: 475, status: 'FILED' }]);
    renderPage();
    await waitFor(() => expect(screen.getByText('CA')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Register/i }));
    await waitFor(() => expect(useTaxApi.getRegister).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('2026-06')).toBeInTheDocument());
  });
});

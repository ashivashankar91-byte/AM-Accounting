/**
 * BankReconSessionDetail.test.tsx — S054A/S054B smoke tests.
 * Key interaction: complete() rejected out-of-balance shows verbatim red banner.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BankReconSessionDetail from './BankReconSessionDetail';
import { reconSessionApi, autoMatchApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  reconSessionApi: {
    getById: vi.fn(),
    getStatementLines: vi.fn(),
    getBookItems: vi.fn(),
    addStatementLine: vi.fn(),
    importStatementLines: vi.fn(),
    addManualBookItem: vi.fn(),
    syncBookItems: vi.fn(),
    match: vi.fn(),
    unmatch: vi.fn(),
    complete: vi.fn(),
  },
  autoMatchApi: {
    getSuggestions: vi.fn(),
    listRules: vi.fn(),
    run: vi.fn(),
    createRule: vi.fn(),
    confirmSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
  },
}));

const SESSION_ID = 'sess-0001-0000-0000-000000000001';

const SESSION = {
  id: SESSION_ID,
  entityId: 'entity-001',
  bankAccountCode: 'CHK-001',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
  statementBeginningBalance: '10000.00',
  statementEndingBalance: '12500.00',
  status: 'OPEN',
  clearedBalance: '12400.00',
  difference: '100.00',
};

function renderPage(id = SESSION_ID) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/accounting/bank-recon/sessions/${id}`]}>
        <Routes>
          <Route path="/accounting/bank-recon/sessions/:id" element={<BankReconSessionDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockAll() {
  (reconSessionApi.getById as any).mockResolvedValue(SESSION);
  (reconSessionApi.getStatementLines as any).mockResolvedValue([]);
  (reconSessionApi.getBookItems as any).mockResolvedValue([]);
  (autoMatchApi.getSuggestions as any).mockResolvedValue([]);
  (autoMatchApi.listRules as any).mockResolvedValue([]);
}

describe('BankReconSessionDetail', () => {
  it('renders session workspace once loaded', async () => {
    mockAll();
    renderPage();
    await waitFor(() => expect(screen.getByText(/CHK-001/)).toBeInTheDocument());
    expect(screen.getByText(/entity-001/)).toBeInTheDocument();
  });

  it('shows loading state', () => {
    // getById never resolves — stay in loading
    (reconSessionApi.getById as any).mockReturnValue(new Promise(() => {}));
    (reconSessionApi.getStatementLines as any).mockResolvedValue([]);
    (reconSessionApi.getBookItems as any).mockResolvedValue([]);
    (autoMatchApi.getSuggestions as any).mockResolvedValue([]);
    (autoMatchApi.listRules as any).mockResolvedValue([]);
    renderPage();
    expect(screen.getByText(/Loading Reconciliation Session/i)).toBeInTheDocument();
  });

  it('shows error state when session fails to load', async () => {
    (reconSessionApi.getById as any).mockRejectedValue(new Error('recon-service down'));
    (reconSessionApi.getStatementLines as any).mockResolvedValue([]);
    (reconSessionApi.getBookItems as any).mockResolvedValue([]);
    (autoMatchApi.getSuggestions as any).mockResolvedValue([]);
    (autoMatchApi.listRules as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
  });

  it('shows Unauthorized banner on 403', async () => {
    const err: any = new Error('Forbidden');
    err.status = 403;
    (reconSessionApi.getById as any).mockRejectedValue(err);
    (reconSessionApi.getStatementLines as any).mockResolvedValue([]);
    (reconSessionApi.getBookItems as any).mockResolvedValue([]);
    (autoMatchApi.getSuggestions as any).mockResolvedValue([]);
    (autoMatchApi.listRules as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/Unauthorized/i)).toBeInTheDocument());
  });

  it('shows verbatim out-of-balance server error in red banner on complete() refusal', async () => {
    const user = userEvent.setup();
    mockAll();
    const oobError = new Error('OUT_OF_BALANCE: difference is $100.00 — clear all items before completing.');
    (reconSessionApi.complete as any).mockRejectedValue(oobError);

    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Complete Session/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Complete Session/i }));

    await waitFor(() =>
      expect(screen.getByText('OUT_OF_BALANCE: difference is $100.00 — clear all items before completing.')).toBeInTheDocument()
    );
    expect(screen.getByText(/Cannot Complete Session/i)).toBeInTheDocument();
  });

  it('shows completion success message on successful complete()', async () => {
    const user = userEvent.setup();
    mockAll();
    (reconSessionApi.complete as any).mockResolvedValue({ status: 'COMPLETED' });

    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /Complete Session/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Complete Session/i }));

    await waitFor(() => expect(screen.getByText(/Session completed successfully/i)).toBeInTheDocument());
  });

  it('renders empty statement lines state', async () => {
    mockAll();
    renderPage();
    // Wait for session to load
    await waitFor(() => expect(screen.getByText(/entity-001/)).toBeInTheDocument());
    // Statement tab is active by default — check for empty state
    await waitFor(() => expect(screen.getByText(/No statement lines/i)).toBeInTheDocument());
  });
});

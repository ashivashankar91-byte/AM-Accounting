/**
 * CE-10 / S124 — Exception & Outage Queue UI tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaxExceptionQueue from './TaxExceptionQueue';
import { taxApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  taxApi: {
    listExceptions: vi.fn(),
    reRequestException: vi.fn(),
    bulkReRequestExceptions: vi.fn(),
    getAuditTrail: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/accounting/tax/exceptions']}>
        <TaxExceptionQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ROW = {
  id: 'exc-1',
  documentRef: 'RO-1001',
  reasonCode: 'ENGINE_UNAVAILABLE' as const,
  reasonDetail: null,
  parkedAt: '2026-07-01T00:00:00.000Z',
  status: 'PARKED',
};

describe('TaxExceptionQueue', () => {
  it('renders a populated exception queue (happy render)', async () => {
    (taxApi.listExceptions as any).mockResolvedValue({ items: [ROW], total: 1 });
    renderPage();
    expect(await screen.findByTestId('tax-exception-table')).toBeInTheDocument();
    expect(screen.getByText('RO-1001')).toBeInTheDocument();
  });

  it('shows the literal empty state when the queue has no exceptions', async () => {
    (taxApi.listExceptions as any).mockResolvedValue({ items: [], total: 0 });
    renderPage();
    expect(await screen.findByTestId('tax-exceptions-empty')).toBeInTheDocument();
    expect(screen.getByText('No tax exceptions — engine healthy.')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('Missing required permission: tax.exception.view');
    err.status = 401;
    (taxApi.listExceptions as any).mockRejectedValue(err);
    renderPage();
    expect(await screen.findByTestId('tax-exceptions-unauthorized')).toBeInTheDocument();
    expect(screen.getByText(/tax.exception.view/)).toBeInTheDocument();
  });

  it('re-requests a single exception successfully', async () => {
    const user = userEvent.setup();
    (taxApi.listExceptions as any).mockResolvedValue({ items: [ROW], total: 1 });
    (taxApi.reRequestException as any).mockResolvedValue({ ...ROW, status: 'RESOLVED' });
    renderPage();

    await screen.findByTestId('tax-exception-table');
    await user.click(screen.getByTestId('tax-exception-re-request-exc-1'));
    await waitFor(() => expect(taxApi.reRequestException).toHaveBeenCalledWith('exc-1'));
  });

  it('shows a re-request validation/API failure inline on the row', async () => {
    const user = userEvent.setup();
    (taxApi.listExceptions as any).mockResolvedValue({ items: [ROW], total: 1 });
    const err: any = new Error('Engine still unavailable — re-request rejected.');
    (taxApi.reRequestException as any).mockRejectedValue(err);
    renderPage();

    await screen.findByTestId('tax-exception-table');
    await user.click(screen.getByTestId('tax-exception-re-request-exc-1'));
    await waitFor(() => expect(screen.getByTestId('tax-exception-error-exc-1')).toHaveTextContent(/still unavailable/));
  });
});

/**
 * CE-11 mandatory UI screen #11 — Exception & Recovery Queue UI tests.
 * Merges fixedops-service exceptions with parts-accounting-service
 * exceptions (fetched via rawApiFetch) into one worklist.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FixedOpsExceptionQueue from './FixedOpsExceptionQueue';
import { fixedopsApi, rawApiFetch } from '../../../api/fixedopsApi';

vi.mock('../../../api/fixedopsApi', () => ({
  fixedopsApi: {
    listExceptions: vi.fn(),
    resolveException: vi.fn(),
  },
  rawApiFetch: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/accounting/fixedops/exceptions']}>
        <FixedOpsExceptionQueue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FIXEDOPS_EXC = { id: 'fe-1', roNumber: 'RO-4001', eventFamily: 'RO_CLOSE_CUSTOMER', reasonCode: 'TAX_RESULT_UNAVAILABLE', detail: null, status: 'OPEN', correlationId: 'c1', createdAt: '2026-07-01T00:00:00.000Z', resolvedAt: null, resolvedBy: null };
const PARTS_EXC = { id: 'pe-1', partNumber: 'P-999', eventFamily: 'PARTS_RO_ISSUE', reasonCode: 'NEGATIVE_ON_HAND', detail: null, status: 'OPEN', correlationId: 'c2', createdAt: '2026-07-02T00:00:00.000Z', resolvedAt: null, resolvedBy: null };

describe('FixedOpsExceptionQueue', () => {
  it('merges Service and Parts exceptions into one table, tagged by source', async () => {
    (fixedopsApi.listExceptions as any).mockResolvedValue({ items: [FIXEDOPS_EXC] });
    (rawApiFetch as any).mockResolvedValue({ items: [PARTS_EXC] });
    renderPage();

    expect(await screen.findByTestId('fixedops-exceptions-table')).toBeInTheDocument();
    expect(screen.getByTestId('fixedops-exception-row-fe-1')).toHaveTextContent('Service');
    expect(screen.getByTestId('fixedops-exception-row-pe-1')).toHaveTextContent('Parts');
    expect(rawApiFetch).toHaveBeenCalledWith('/api/v1/parts-accounting/exceptions');
  });

  it('shows the empty state when both sources have no exceptions', async () => {
    (fixedopsApi.listExceptions as any).mockResolvedValue({ items: [] });
    (rawApiFetch as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('fixedops-exceptions-empty')).toBeInTheDocument();
  });

  it('shows the error state if either source fails', async () => {
    (fixedopsApi.listExceptions as any).mockRejectedValue(new Error('fixedops-service unreachable'));
    (rawApiFetch as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('fixedops-exceptions-error')).toBeInTheDocument();
  });

  it('shows the unauthorized state on a 401/403 response', async () => {
    const err: any = new Error('no permission'); err.status = 403;
    (fixedopsApi.listExceptions as any).mockRejectedValue(err);
    (rawApiFetch as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('fixedops-exceptions-unauthorized')).toBeInTheDocument();
  });

  it('resolve calls the fixedops resolveException for a Service-sourced row', async () => {
    const user = userEvent.setup();
    (fixedopsApi.listExceptions as any).mockResolvedValue({ items: [FIXEDOPS_EXC] });
    (rawApiFetch as any).mockResolvedValue({ items: [] });
    (fixedopsApi.resolveException as any).mockResolvedValue({ ...FIXEDOPS_EXC, status: 'RESOLVED' });
    renderPage();
    await screen.findByTestId('fixedops-exceptions-table');

    await user.click(screen.getByTestId('fixedops-exception-resolve-fe-1'));
    await waitFor(() => expect(fixedopsApi.resolveException).toHaveBeenCalledWith('fe-1'));
  });

  it('resolve calls the raw parts-accounting endpoint for a Parts-sourced row', async () => {
    const user = userEvent.setup();
    (fixedopsApi.listExceptions as any).mockResolvedValue({ items: [] });
    (rawApiFetch as any).mockImplementation((path: string) => {
      if (path === '/api/v1/parts-accounting/exceptions') return Promise.resolve({ items: [PARTS_EXC] });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByTestId('fixedops-exceptions-table');

    await user.click(screen.getByTestId('fixedops-exception-resolve-pe-1'));
    await waitFor(() => expect(rawApiFetch).toHaveBeenCalledWith('/api/v1/parts-accounting/exceptions/pe-1/resolve', { method: 'POST' }));
  });
});

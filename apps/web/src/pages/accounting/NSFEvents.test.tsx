/**
 * AMACC S045 — NSFEvents smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NSFEvents from './NSFEvents';
import { nsfEventApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  nsfEventApi: {
    list: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NSFEvents />
    </QueryClientProvider>,
  );
}

const NSF = {
  id: 'nsf-1',
  customerId: 'cust-1',
  originalArEntryId: 'ar-entry-1',
  amount: '300.00',
  reason: 'Returned check',
  source: 'MANUAL' as const,
  status: 'OPEN',
  createdAt: '2026-07-01T10:00:00Z',
};

describe('NSFEvents list', () => {
  it('shows loading state initially', () => {
    (nsfEventApi.list as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading NSF Events/i)).toBeInTheDocument();
  });

  it('shows empty state when no events exist', async () => {
    (nsfEventApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No NSF events recorded/i)).toBeInTheDocument());
  });

  it('shows error state with retry', async () => {
    (nsfEventApi.list as any).mockRejectedValue(new Error('service down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('shows unauthorized message for 401', async () => {
    const err: any = new Error('Unauthorized');
    err.status = 401;
    (nsfEventApi.list as any).mockRejectedValue(err);
    renderPage();
    await waitFor(() => expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument());
  });

  it('renders NSF event rows', async () => {
    (nsfEventApi.list as any).mockResolvedValue([NSF]);
    renderPage();
    await waitFor(() => expect(screen.getByText('cust-1')).toBeInTheDocument());
    expect(screen.getByText('ar-entry-1')).toBeInTheDocument();
    expect(screen.getByText('Returned check')).toBeInTheDocument();
  });
});

describe('NSFEvents create', () => {
  it('creates a new NSF event', async () => {
    const user = userEvent.setup();
    (nsfEventApi.list as any).mockResolvedValue([]);
    (nsfEventApi.create as any).mockResolvedValue(NSF);
    (nsfEventApi.getById as any).mockResolvedValue(NSF);
    renderPage();

    await waitFor(() => expect(screen.getByText(/No NSF events recorded/i)).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: /New NSF Event/i })[0]);

    await user.type(screen.getByPlaceholderText('cust-uuid'), 'cust-1');
    await user.type(screen.getByPlaceholderText('ar-entry-uuid'), 'ar-entry-1');
    await user.type(screen.getByPlaceholderText('0.00'), '300');
    await user.type(screen.getByPlaceholderText(/Returned check/i), 'Returned check');

    await user.click(screen.getByRole('button', { name: /Create NSF Event/i }));
    await waitFor(() => expect(nsfEventApi.create).toHaveBeenCalledWith({
      customerId: 'cust-1',
      originalArEntryId: 'ar-entry-1',
      amount: 300,
      reason: 'Returned check',
      source: undefined,
    }));
  });
});

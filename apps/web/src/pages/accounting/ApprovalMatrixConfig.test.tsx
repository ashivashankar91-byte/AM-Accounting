/**
 * AMACC-CH04 S041 — ApprovalMatrixConfig UI smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ApprovalMatrixConfig from './ApprovalMatrixConfig';
import { approvalRuleApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  approvalRuleApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><ApprovalMatrixConfig /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ApprovalMatrixConfig', () => {
  it('shows the conservative-default empty state when no tiers are configured', async () => {
    (approvalRuleApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No tiers configured/i)).toBeInTheDocument());
  });

  it('renders configured tiers', async () => {
    (approvalRuleApi.list as any).mockResolvedValue([
      { id: 'rule-1', sequence: 1, thresholdAmount: '5000.00', requiredRole: 'CONTROLLER', isActive: true },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('CONTROLLER')).toBeInTheDocument());
    expect(screen.getByText('$5,000.00+')).toBeInTheDocument();
  });

  it('creates a new tier via the Add Tier dialog', async () => {
    const user = userEvent.setup();
    (approvalRuleApi.list as any).mockResolvedValue([]);
    (approvalRuleApi.create as any).mockResolvedValue({ id: 'rule-2', sequence: 1, thresholdAmount: '1000.00', requiredRole: 'ACCOUNTANT', isActive: true });
    renderPage();

    await waitFor(() => expect(screen.getByText(/No tiers configured/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Add Tier/i }));
    await user.click(screen.getByRole('button', { name: /Save Tier/i }));
    await waitFor(() => expect(approvalRuleApi.create).toHaveBeenCalled());
  });
});

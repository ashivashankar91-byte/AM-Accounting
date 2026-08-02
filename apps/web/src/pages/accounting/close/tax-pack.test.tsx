/**
 * S117 — Year-End Tax Pack smoke tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaxPack from './tax-pack';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: { generateTaxPack: vi.fn() },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('TaxPack', () => {
  it('renders S117 title', () => {
    render(wrap(<TaxPack />));
    expect(screen.getByText(/Year-End Tax Pack \(S117\)/i)).toBeTruthy();
  });

  it('calls generateTaxPack on submit', async () => {
    (closeApi.generateTaxPack as any).mockResolvedValue({ packId: 'tp1' });
    render(wrap(<TaxPack />));
    const btn = screen.getByRole('button', { name: /generate/i });
    await userEvent.click(btn);
    await waitFor(() => expect(closeApi.generateTaxPack).toHaveBeenCalled());
  });
});

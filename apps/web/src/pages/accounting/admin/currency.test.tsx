/**
 * S015 — Currency & Translation smoke tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Currency from './currency';
import { closeApi } from '../../../api/client';

vi.mock('../../../api/client', () => ({
  closeApi: {
    getCurrencyConfig: vi.fn(),
    setCurrencyConfig: vi.fn(),
    addRate: vi.fn(),
    listRates: vi.fn(),
    previewTranslation: vi.fn(),
    approveTranslation: vi.fn(),
    postTranslation: vi.fn(),
  },
}));

const wrap = (ui: React.ReactElement) => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </QueryClientProvider>
  </MemoryRouter>
);

describe('Currency', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    (closeApi.getCurrencyConfig as any).mockReturnValue(new Promise(() => {}));
    (closeApi.listRates as any).mockReturnValue(new Promise(() => {}));
    render(wrap(<Currency />));
    expect(screen.getByText(/loading|currency/i)).toBeTruthy();
  });

  it('renders S015 title', async () => {
    (closeApi.getCurrencyConfig as any).mockResolvedValue({ functionalCurrency: 'USD', reportingCurrency: 'USD' });
    (closeApi.listRates as any).mockResolvedValue([]);
    render(wrap(<Currency />));
    await waitFor(() => expect(screen.getByText(/S015|currency/i)).toBeTruthy());
  });
});

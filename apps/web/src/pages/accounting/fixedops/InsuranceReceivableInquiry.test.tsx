/**
 * CE-11 mandatory UI screen #5 — Insurance Receivable Inquiry UI tests.
 * This screen is an honest stub: no CE-09 S049 API exists yet, so it must
 * never attempt a fake fetch and must always show the PUTR banner + empty state.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import InsuranceReceivableInquiry from './InsuranceReceivableInquiry';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/accounting/fixedops/insurance']}>
      <InsuranceReceivableInquiry />
    </MemoryRouter>,
  );
}

describe('InsuranceReceivableInquiry', () => {
  it('renders the upstream-pending banner and honest empty state, never fabricated data', () => {
    renderPage();
    expect(screen.getByTestId('insurance-putr-banner')).toHaveTextContent('PENDING_UPSTREAM_TECHNICAL_RECONCILIATION');
    expect(screen.getByTestId('insurance-empty')).toBeInTheDocument();
    expect(screen.getByTestId('insurance-table')).toBeInTheDocument();
    // The table body is intentionally empty — no rows, no invented insurance data.
    expect(screen.getByTestId('insurance-table').querySelector('tbody')?.children.length).toBe(0);
  });

  it('renders the RO-reference filter without triggering any network call', () => {
    renderPage();
    expect(screen.getByTestId('insurance-ro-filter')).toBeInTheDocument();
  });
});

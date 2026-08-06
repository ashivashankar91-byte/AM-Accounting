/**
 * fix(integration) Gap 4 / requirement 1.D — Payroll Audit UI tests. Covers
 * the unauthorized state (payroll.audit.view absent), the happy render with
 * real audit entries, the empty state, and the API-error state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PayrollAudit from './PayrollAudit';
import { payrollApi } from '../../../api/client';
import { PAYROLL_PERMISSIONS } from './payrollPermissionKeys';

vi.mock('../../../api/client', () => ({
  payrollApi: {
    getAudit: vi.fn(),
  },
}));

vi.mock('../../../context/EntityScopeContext', () => ({
  useEntityScope: () => ({
    entityId: 'entity-1', entityLabel: 'CE13-A — CE13 Cert Legal Entity A', storeId: null, consolidated: false,
    entities: [{ id: 'entity-1', entityCode: 'CE13-A', legalName: 'CE13 Cert Legal Entity A' }],
    loading: false, noEntitiesConfigured: false, error: null,
    setEntity: vi.fn(), setStore: vi.fn(), setConsolidated: vi.fn(),
  }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/accounting/payroll/audit']}>
        <PayrollAudit />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ENTRY = {
  id: 'audit-1', kind: 'SOURCE_EVENT', action: 'PAYROLL_BATCH_POSTED', actor: 'author-1',
  occurredAt: '2026-06-01T12:00:00.000Z', batchId: 'batch-1', employeeId: null,
  journalEntryId: 'je-1', reversalOfBatchId: null,
};

describe('PayrollAudit', () => {
  it('shows the unauthorized state when payroll.audit.view is absent — never renders filters or a table', async () => {
    localStorage.setItem('userPermissions', JSON.stringify([]));
    renderPage();
    expect(await screen.findByTestId('payroll-audit-unauthorized')).toBeInTheDocument();
    expect(screen.queryByTestId('payroll-audit-filters')).not.toBeInTheDocument();
    expect(payrollApi.getAudit).not.toHaveBeenCalled();
  });

  it('renders real audit entries with journal linkage (happy render)', async () => {
    localStorage.setItem('userPermissions', JSON.stringify([PAYROLL_PERMISSIONS.AUDIT_VIEW]));
    (payrollApi.getAudit as any).mockResolvedValue({ items: [ENTRY] });
    renderPage();
    expect(await screen.findByTestId('payroll-audit-table')).toBeInTheDocument();
    expect(screen.getByTestId('payroll-audit-row-audit-1')).toHaveTextContent('PAYROLL_BATCH_POSTED');
    expect(screen.getByTestId('payroll-audit-row-audit-1')).toHaveTextContent('je-1');
  });

  it('shows the empty state when no audit entries match', async () => {
    localStorage.setItem('userPermissions', JSON.stringify([PAYROLL_PERMISSIONS.AUDIT_VIEW]));
    (payrollApi.getAudit as any).mockResolvedValue({ items: [] });
    renderPage();
    expect(await screen.findByTestId('payroll-audit-empty')).toBeInTheDocument();
  });

  it('shows an API-error state when the audit query fails for a reason other than 401/403', async () => {
    localStorage.setItem('userPermissions', JSON.stringify([PAYROLL_PERMISSIONS.AUDIT_VIEW]));
    (payrollApi.getAudit as any).mockRejectedValue(new Error('payroll-service unreachable'));
    renderPage();
    expect(await screen.findByText('Failed to Load')).toBeInTheDocument();
    expect(screen.getByText('payroll-service unreachable')).toBeInTheDocument();
  });
});

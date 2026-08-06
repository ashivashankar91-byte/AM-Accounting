/**
 * CE-08 — ScheduleOpenItems UI smoke tests for the S029 ceremony actions
 * (split/transfer/write-off), the S027-completion exception queue tab, and
 * the S030 statements/dunning tab. Mirrors the pattern in
 * VendorInvoices.test.tsx / VendorMaintenance.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ScheduleOpenItems from './ScheduleOpenItems';
import { scheduleApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  scheduleApi: {
    getOpenItems: vi.fn(),
    getOpenItem: vi.fn(),
    applyOpenItem: vi.fn(),
    reverseApplication: vi.fn(),
    getTieOuts: vi.fn(),
    runTieOut: vi.fn(),
    getAgingReport: vi.fn(),
    getAgingBucketConfig: vi.fn(),
    setAgingBucketConfig: vi.fn(),
    autoApply: vi.fn(),
    splitOpenItem: vi.fn(),
    transferOpenItem: vi.fn(),
    writeOffOpenItem: vi.fn(),
    getWriteOffConfig: vi.fn(),
    setWriteOffConfig: vi.fn(),
    runExceptionEvaluation: vi.fn(),
    getExceptions: vi.fn(),
    dispositionException: vi.fn(),
    getExceptionRuleConfig: vi.fn(),
    setExceptionRuleConfig: vi.fn(),
    generateStatement: vi.fn(),
    listStatementRuns: vi.fn(),
    getStatementRun: vi.fn(),
    generateDunning: vi.fn(),
    listDunningRuns: vi.fn(),
    getDunningConfig: vi.fn(),
    setDunningConfig: vi.fn(),
  },
}));

function renderPage(initialPath = '/accounting/schedules/open-items') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/accounting/schedules/open-items" element={<ScheduleOpenItems />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const OPEN_ITEM = {
  id: 'item-1',
  itemNumber: 'IT-1',
  controlNumber: 'CUST1',
  scheduleNumber: '01',
  originalAmount: '500.00',
  appliedAmount: '0.00',
  remainingBalance: '500.00',
  dueDate: null,
  status: 'OPEN',
  applications: [],
};

describe('ScheduleOpenItems — CE-08 ceremony actions', () => {
  it('shows Split / Transfer / Write Off actions for an open item', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([OPEN_ITEM]);
    renderPage('/accounting/schedules/open-items?schedule=01');

    await waitFor(() => expect(scheduleApi.getOpenItems).toHaveBeenCalled());
    expect(await screen.findByTestId('split-button-IT-1')).toBeInTheDocument();
    expect(screen.getByTestId('transfer-button-IT-1')).toBeInTheDocument();
    expect(screen.getByTestId('writeoff-button-IT-1')).toBeInTheDocument();
  });

  it('does not show ceremony actions for a WRITTEN_OFF item', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([{ ...OPEN_ITEM, status: 'WRITTEN_OFF' }]);
    renderPage('/accounting/schedules/open-items?schedule=01');

    await waitFor(() => expect(scheduleApi.getOpenItems).toHaveBeenCalled());
    await screen.findByText('WRITTEN OFF');
    expect(screen.queryByTestId('split-button-IT-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('writeoff-button-IT-1')).not.toBeInTheDocument();
  });

  it('submits a split with the entered parts and reason', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([OPEN_ITEM]);
    (scheduleApi.splitOpenItem as any).mockResolvedValue({ id: 'split-1' });
    const user = userEvent.setup();
    renderPage('/accounting/schedules/open-items?schedule=01');

    await screen.findByTestId('split-button-IT-1');
    await user.click(screen.getByTestId('split-button-IT-1'));
    await user.type(screen.getByTestId('split-part-input-0'), '300.00');
    await user.type(screen.getByTestId('split-part-input-1'), '200.00');
    await user.type(screen.getByTestId('split-reason-input'), 'Customer requested partial dispute hold');
    await user.click(screen.getByTestId('split-submit-button'));

    await waitFor(() =>
      expect(scheduleApi.splitOpenItem).toHaveBeenCalledWith(
        '01',
        'item-1',
        expect.objectContaining({ parts: ['300.00', '200.00'], reason: 'Customer requested partial dispute hold' }),
      ),
    );
  });

  it('submits a write-off with the offset account and reason', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([OPEN_ITEM]);
    (scheduleApi.writeOffOpenItem as any).mockResolvedValue({ id: 'wo-1' });
    const user = userEvent.setup();
    renderPage('/accounting/schedules/open-items?schedule=01');

    await screen.findByTestId('writeoff-button-IT-1');
    await user.click(screen.getByTestId('writeoff-button-IT-1'));
    await user.type(screen.getByTestId('writeoff-offset-account-input'), '6300');
    await user.type(screen.getByTestId('writeoff-reason-input'), 'Uncollectible, exhausted collection efforts');
    await user.click(screen.getByTestId('writeoff-submit-button'));

    await waitFor(() =>
      expect(scheduleApi.writeOffOpenItem).toHaveBeenCalledWith(
        '01',
        'item-1',
        expect.objectContaining({ offsetAccountCode: '6300', reason: 'Uncollectible, exhausted collection efforts' }),
      ),
    );
  });

  it('renders the Exceptions tab and lists open exceptions', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([]);
    (scheduleApi.getExceptions as any).mockResolvedValue([
      { id: 'exc-1', scheduleNumber: '01', controlNumber: 'CUST1', itemNumber: 'IT-1', ruleType: 'STALE', detail: 'No activity in 90+ days', status: 'OPEN' },
    ]);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('exceptions-tab-button'));
    expect(await screen.findByText('STALE')).toBeInTheDocument();
    expect(screen.getByTestId('disposition-button-exc-1')).toBeDisabled();
  });

  it('renders the Statements & Dunning tab and can generate a statement', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([]);
    (scheduleApi.listStatementRuns as any).mockResolvedValue([]);
    (scheduleApi.listDunningRuns as any).mockResolvedValue([]);
    (scheduleApi.generateStatement as any).mockResolvedValue({ id: 'stmt-1' });
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByTestId('statements-tab-button'));
    await user.type(screen.getByTestId('statements-schedule-input'), '01');
    await user.type(screen.getByTestId('statements-control-input'), 'CUST1');
    await user.click(screen.getByTestId('generate-statement-button'));

    await waitFor(() =>
      expect(scheduleApi.generateStatement).toHaveBeenCalledWith({ scheduleNumber: '01', controlNumber: 'CUST1' }),
    );
  });

  it('S028 FIFO Auto-Apply: finds eligible items, requires confirmation, then calls the real API', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([OPEN_ITEM]);
    (scheduleApi.autoApply as any).mockResolvedValue({ outcome: 'AUTO_APPLIED' });
    const user = userEvent.setup();
    renderPage('/accounting/schedules/open-items?schedule=01');

    await user.click(screen.getByTestId('auto-apply-tab-button'));
    // Amount is never calculated in the browser: only entered by the operator
    // and passed through verbatim to the real server-side FIFO sweep.
    await user.type(screen.getByTestId('auto-apply-control-input'), 'CUST1');
    await user.type(screen.getByTestId('auto-apply-amount-input'), '150.00');
    await user.click(screen.getByTestId('auto-apply-search-button'));

    expect(await screen.findByTestId('auto-apply-eligible-row-IT-1')).toBeInTheDocument();

    // The open-confirm button must not itself call the API — a confirmation
    // step is required first.
    await user.click(screen.getByTestId('auto-apply-open-confirm-button'));
    expect(scheduleApi.autoApply).not.toHaveBeenCalled();
    expect(screen.getByTestId('auto-apply-confirm-button')).toBeInTheDocument();

    await user.click(screen.getByTestId('auto-apply-confirm-button'));

    await waitFor(() =>
      expect(scheduleApi.autoApply).toHaveBeenCalledWith(
        expect.objectContaining({ scheduleNumber: '01', controlNumber: 'CUST1', amount: '150.00' }),
      ),
    );
    expect(await screen.findByTestId('auto-apply-result-banner')).toHaveTextContent('AUTO_APPLIED');
  });

  it('S028 FIFO Auto-Apply: shows the empty state when no eligible items are found', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage('/accounting/schedules/open-items?schedule=01');

    await user.click(screen.getByTestId('auto-apply-tab-button'));
    await user.type(screen.getByTestId('auto-apply-control-input'), 'CUST-NONE');
    await user.click(screen.getByTestId('auto-apply-search-button'));

    expect(await screen.findByTestId('auto-apply-empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('auto-apply-open-confirm-button')).toBeDisabled();
  });

  it('S028 FIFO Auto-Apply: surfaces a permission-denied (403) error without fabricating data', async () => {
    const forbidden: any = new Error('Forbidden');
    forbidden.status = 403;
    (scheduleApi.getOpenItems as any).mockRejectedValue(forbidden);
    const user = userEvent.setup();
    renderPage('/accounting/schedules/open-items?schedule=01');

    await user.click(screen.getByTestId('auto-apply-tab-button'));
    await user.type(screen.getByTestId('auto-apply-control-input'), 'CUST1');
    await user.click(screen.getByTestId('auto-apply-search-button'));

    expect(await screen.findByTestId('auto-apply-error-banner')).toHaveTextContent('permission');
    expect(screen.queryByTestId('auto-apply-eligible-row-IT-1')).not.toBeInTheDocument();
  });

  it('S028 FIFO Auto-Apply: validation disables actions until control# and amount are present', async () => {
    (scheduleApi.getOpenItems as any).mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage('/accounting/schedules/open-items?schedule=01');

    await user.click(screen.getByTestId('auto-apply-tab-button'));
    expect(screen.getByTestId('auto-apply-search-button')).toBeDisabled();
    expect(screen.getByTestId('auto-apply-open-confirm-button')).toBeDisabled();
  });
});

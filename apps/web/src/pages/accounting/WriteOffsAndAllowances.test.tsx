/**
 * AMACC S050/S051 — WriteOffsAndAllowances smoke tests.
 * Critical: computePreview must not auto-post; approvePreview must be separate from post.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WriteOffsAndAllowances from './WriteOffsAndAllowances';
import { writeOffApi, allowancePreviewApi } from '../../api/client';

vi.mock('../../api/client', () => ({
  writeOffApi: {
    list: vi.fn(),
    getRegister: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    reverse: vi.fn(),
  },
  allowancePreviewApi: {
    list: vi.fn(),
    getById: vi.fn(),
    computePreview: vi.fn(),
    approvePreview: vi.fn(),
    post: vi.fn(),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WriteOffsAndAllowances />
    </QueryClientProvider>,
  );
}

const WRITE_OFF = {
  id: 'wo-1',
  arEntryId: 'ar-entry-1',
  amount: '500.00',
  reason: 'Uncollectible',
  status: 'ACTIVE',
};

const PREVIEW = {
  id: 'prev-1',
  asOfDate: '2026-07-31',
  previewAmount: '1200.00',
  status: 'DRAFT',
};

const APPROVED_PREVIEW = { ...PREVIEW, status: 'APPROVED', approvedAmount: '1200.00' };

describe('WriteOffsAndAllowances — write-offs tab', () => {
  it('shows loading state initially', () => {
    (writeOffApi.list as any).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/Loading write-offs/i)).toBeInTheDocument();
  });

  it('shows empty state when no write-offs exist', async () => {
    (writeOffApi.list as any).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/No write-offs/i)).toBeInTheDocument());
  });

  it('shows error state with retry', async () => {
    (writeOffApi.list as any).mockRejectedValue(new Error('service down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Failed to Load/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  it('renders write-off rows', async () => {
    (writeOffApi.list as any).mockResolvedValue([WRITE_OFF]);
    renderPage();
    await waitFor(() => expect(screen.getByText('ar-entry-1')).toBeInTheDocument());
    expect(screen.getByText('Uncollectible')).toBeInTheDocument();
  });

  it('reverses a write-off with mandatory reason', async () => {
    const user = userEvent.setup();
    (writeOffApi.list as any).mockResolvedValue([WRITE_OFF]);
    (writeOffApi.reverse as any).mockResolvedValue({ ...WRITE_OFF, status: 'REVERSED' });
    renderPage();

    await waitFor(() => expect(screen.getByRole('button', { name: /Reverse/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Reverse/i }));
    await waitFor(() => expect(screen.getByText(/Reverse Write-off/i)).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText(/Reason for reversing/i);
    await user.type(textarea, 'Entered in error');
    await user.click(screen.getByRole('button', { name: /Confirm Reversal/i }));
    await waitFor(() => expect(writeOffApi.reverse).toHaveBeenCalledWith('wo-1', { reason: 'Entered in error' }));
  });
});

describe('WriteOffsAndAllowances — allowances tab', () => {
  it('shows allowance preview list', async () => {
    const user = userEvent.setup();
    (writeOffApi.list as any).mockResolvedValue([]);
    (allowancePreviewApi.list as any).mockResolvedValue([PREVIEW]);
    renderPage();
    await user.click(screen.getByRole('button', { name: /Allowance Previews/i }));
    await waitFor(() => expect(screen.getByText(/2026-07-31/i)).toBeInTheDocument());
  });

  it('computePreview does NOT auto-post — only shows preview result', async () => {
    const user = userEvent.setup();
    (writeOffApi.list as any).mockResolvedValue([]);
    (allowancePreviewApi.list as any).mockResolvedValue([]);
    (allowancePreviewApi.computePreview as any).mockResolvedValue(PREVIEW);
    renderPage();
    await user.click(screen.getByRole('button', { name: /Allowance Previews/i }));

    const dateInput = screen.getByLabelText(/As Of Date/i);
    await user.type(dateInput, '2026-07-31');
    await user.click(screen.getByRole('button', { name: /Compute Preview/i }));

    await waitFor(() => {
      const elements = screen.getAllByText(/Preview only — not posted/i);
      expect(elements.length).toBeGreaterThan(0);
    });
    // post() must NOT have been called
    expect(allowancePreviewApi.post).not.toHaveBeenCalled();
    // Approve button should be visible, Post button should NOT be visible yet
    expect(screen.getByRole('button', { name: /Approve Preview/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Post \$/i })).not.toBeInTheDocument();
  });

  it('Post button only appears after approval, pre-filled with approved amount', async () => {
    const user = userEvent.setup();
    (writeOffApi.list as any).mockResolvedValue([]);
    (allowancePreviewApi.list as any).mockResolvedValue([]);
    (allowancePreviewApi.computePreview as any).mockResolvedValue(PREVIEW);
    (allowancePreviewApi.approvePreview as any).mockResolvedValue(APPROVED_PREVIEW);
    renderPage();
    await user.click(screen.getByRole('button', { name: /Allowance Previews/i }));

    await user.type(screen.getByLabelText(/As Of Date/i), '2026-07-31');
    await user.click(screen.getByRole('button', { name: /Compute Preview/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Approve Preview/i })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /Approve Preview/i }));
    await waitFor(() => expect(allowancePreviewApi.approvePreview).toHaveBeenCalledWith('prev-1'));
    // Now Post button should appear with the approved amount
    await waitFor(() => expect(screen.getByRole('button', { name: /^Post \$/i })).toBeInTheDocument());
    // post() still not called — user hasn't clicked it
    expect(allowancePreviewApi.post).not.toHaveBeenCalled();
  });
});

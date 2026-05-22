/**
 * @test G-07 — AcctGLPurgeHandler (ACCT_200 EOM step)
 * @cobol-origin purge.cbl INV-EOM-09 (GL-OPEN-BAL formula) + INV-EOM-07 (8-year retention)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AcctGLPurgeHandler } from '../domain/step-handlers';

function makeContext(overrides: Partial<any> = {}): any {
  return {
    tenantId: 'tenant-test',
    periodEnd: '2026-03-31',
    closeId: 'close-uuid-1',
    getPreviousStepResult: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

describe('AcctGLPurgeHandler (G-07 / ACCT_200)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('canHandle returns true only for ACCT_200', () => {
    const handler = new AcctGLPurgeHandler();
    expect(handler.canHandle('ACCT_200')).toBe(true);
    expect(handler.canHandle('ACCT_100')).toBe(false);
    expect(handler.canHandle('ACCT_300')).toBe(false);
    expect(handler.canHandle('068')).toBe(false);
  });

  it('calls gl-service /admin/period-carry-forward with correct body', async () => {
    const mockResult = {
      accountsUpdated: 42,
      historyRecordsPurged: 1500,
      periodBalancesConsolidated: 42,
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'COMPLETE', tenantId: 'tenant-test', ...mockResult }),
    } as any);

    const handler = new AcctGLPurgeHandler();
    const result = await handler.execute(makeContext());

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/admin/period-carry-forward'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-tenant-id': 'tenant-test' }),
      }),
    );

    const callBody = JSON.parse((fetchSpy.mock.calls[0]![1] as any).body);
    expect(callBody.periodYear).toBe(2026);
    expect(callBody.periodMonth).toBe(3);
    // 8-year retention: cutoff should be approximately 2018-03-31
    expect(new Date(callBody.purgeHistoryBeforeDate).getFullYear()).toBe(2018);
  });

  it('returns success: true with nextStepCode ACCT_300 on success', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'COMPLETE',
        accountsUpdated: 10,
        historyRecordsPurged: 100,
        periodBalancesConsolidated: 10,
      }),
    } as any);

    const handler = new AcctGLPurgeHandler();
    const result = await handler.execute(makeContext());

    expect(result.success).toBe(true);
    expect(result.stepCode).toBe('ACCT_200');
    expect(result.nextStepCode).toBe('ACCT_300');
    expect(result.message).toContain('carry-forward complete');
  });

  it('returns success: false when gl-service returns non-ok status', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as any);

    const handler = new AcctGLPurgeHandler();
    const result = await handler.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.stepCode).toBe('ACCT_200');
    expect(result.message).toContain('HTTP 500');
  });

  it('returns success: false on network error (fetch throws)', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockRejectedValue(new Error('ECONNREFUSED'));

    const handler = new AcctGLPurgeHandler();
    const result = await handler.execute(makeContext());

    expect(result.success).toBe(false);
    expect(result.message).toContain('ECONNREFUSED');
  });

  it('period carry-forward includes result counts in success message', async () => {
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        accountsUpdated: 7,
        historyRecordsPurged: 999,
        periodBalancesConsolidated: 7,
      }),
    } as any);

    const handler = new AcctGLPurgeHandler();
    const result = await handler.execute(makeContext());

    expect(result.message).toContain('7 accounts updated');
    expect(result.message).toContain('999 history records purged');
  });
});

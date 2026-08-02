/**
 * @test G-02 — FinanceChargeJob
 * @cobol-origin finchg.cbl FINANCE-CHARGE-CALC + POST-FC-JOURNAL paragraphs
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FinanceChargeJob } from '../application/finance-charge-job';

const BASE_CONFIG = {
  annualRatePercent: 18,
  minimumBalance: 0.01,
  journalSource: 'FC',
  gracePeriodDays: 0,
};

const TENANT = 'tenant-test';
const AS_OF = new Date('2026-03-31');
const TOKEN = 'test-service-token';

function makeSchedulesFetch(schedules: any[]) {
  return { ok: true, json: async () => schedules };
}

function makeDetailsFetch(details: any[]) {
  return { ok: true, json: async () => details };
}

function makePostingEngineFetch(journalEntryId = 'je-fc-1', executionId = 'exec-1') {
  return { ok: true, json: async () => ({ status: 'POSTED', journalEntryId, executionId }) };
}

describe('FinanceChargeJob (G-02 / finchg.cbl)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 charges when no eligible detail records', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([]) as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.controlNumbersCharged).toBe(0);
    expect(result.totalFinanceCharge).toBe(0);
    expect(result.journalEntryId).toBeNull();
    expect(result.errors).toHaveLength(0);
  });

  it('calculates monthly finance charge as annualRate / 1200 * balance', async () => {
    // 18% APR → 1.5% monthly → $100 * 0.015 = $1.50
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: null, transactionDate: '2026-01-01', isBalanceForward: false,
        },
      ]) as any)
      .mockResolvedValueOnce(makePostingEngineFetch() as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.totalFinanceCharge).toBeCloseTo(1.50, 2);
    expect(result.controlNumbersCharged).toBe(1);
    expect(result.journalEntryId).toBe('je-fc-1');
  });

  it('skips records where applyCd is already set (already charged)', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: 'F', transactionDate: '2026-01-01', isBalanceForward: false,
        },
      ]) as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.controlNumbersCharged).toBe(0);
    expect(result.totalFinanceCharge).toBe(0);
  });

  it('skips records within grace period', async () => {
    const configWithGrace = { ...BASE_CONFIG, gracePeriodDays: 30 };
    // AS_OF = 2026-03-31, transactionDate = 2026-03-20 → 11 days old, within 30-day grace
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '500.00',
          applyCd: null, transactionDate: '2026-03-20', isBalanceForward: false,
        },
      ]) as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, configWithGrace, TOKEN);

    expect(result.controlNumbersCharged).toBe(0);
  });

  it('skips records below minimumBalance', async () => {
    const configHighMin = { ...BASE_CONFIG, minimumBalance: 200.00 };
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: null, transactionDate: '2026-01-01', isBalanceForward: false,
        },
      ]) as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, configHighMin, TOKEN);

    expect(result.controlNumbersCharged).toBe(0);
  });

  it('in dryRun mode, calculates charges but does not post to posting engine', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: null, transactionDate: '2026-01-01', isBalanceForward: false,
        },
      ]) as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN, true);

    expect(result.journalEntryId).toBeNull();
    expect(result.totalFinanceCharge).toBeCloseTo(1.50, 2);
    expect(fetchSpy).toHaveBeenCalledTimes(2); // only schedules + details
  });

  it('includes error in result when schedule details fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce({ ok: false, status: 503 } as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('503');
  });

  it('returns error result when schedules fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce({ ok: false, status: 500 } as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.errors).toHaveLength(1);
    expect(result.journalEntryId).toBeNull();
    expect(result.schedulesProcessed).toBe(0);
  });

  it('aggregates charges by controlNumber across multiple detail records', async () => {
    // Two records with same controlNumber: $100 + $200 = $300 → FC = $300 * 0.015 = $4.50
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: null, transactionDate: '2026-01-01', isBalanceForward: false,
        },
        {
          id: 'd2', controlNumber: 'CN1', amount: '200.00',
          applyCd: null, transactionDate: '2026-01-15', isBalanceForward: false,
        },
      ]) as any)
      .mockResolvedValueOnce(makePostingEngineFetch() as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.controlNumbersCharged).toBe(1);
    expect(result.totalFinanceCharge).toBeCloseTo(4.50, 2);
  });

  it('posts correct FINANCE_CHARGE_CALCULATED event envelope to posting engine', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: null, transactionDate: '2026-01-01', isBalanceForward: false,
        },
      ]) as any)
      .mockResolvedValueOnce(makePostingEngineFetch() as any);

    const job = new FinanceChargeJob();
    await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    const peCallBody = JSON.parse((fetchSpy.mock.calls[2]![1] as any).body);
    expect(peCallBody.eventType).toBe('FINANCE_CHARGE_CALCULATED');
    expect(peCallBody.tenantId).toBe(TENANT);
    expect(peCallBody.payload.totalFinanceCharge).toBe('1.50');
    expect(peCallBody.payload.journalSource).toBe('FC');
    expect(peCallBody.payload.controlNumbers).toContain('CN1');
  });

  it('missing rule-pack mapping (NO_RULE_MATCH) → no GL mutation, error captured in errors', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: null, transactionDate: '2026-01-01', isBalanceForward: false,
        },
      ]) as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'NO_RULE_MATCH', journalEntryId: null, executionId: 'exec-failed' }),
      } as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.journalEntryId).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('NO_RULE_MATCH');
  });

  it('400 from posting engine → no GL mutation, error captured', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: null, transactionDate: '2026-01-01', isBalanceForward: false,
        },
      ]) as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'No active rule pack found' }),
      } as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.journalEntryId).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('400');
  });

  it('journalEntryId populated from posting engine response', async () => {
    vi.spyOn(globalThis, 'fetch' as any)
      .mockResolvedValueOnce(makeSchedulesFetch([{ scheduleNumber: '01' }]) as any)
      .mockResolvedValueOnce(makeDetailsFetch([
        {
          id: 'd1', controlNumber: 'CN1', amount: '100.00',
          applyCd: null, transactionDate: '2026-01-01', isBalanceForward: false,
        },
      ]) as any)
      .mockResolvedValueOnce(makePostingEngineFetch('je-from-engine', 'exec-xyz') as any);

    const job = new FinanceChargeJob();
    const result = await job.run(TENANT, AS_OF, BASE_CONFIG, TOKEN);

    expect(result.journalEntryId).toBe('je-from-engine');
    expect(result.postingExecutionId).toBe('exec-xyz');
    expect(result.eventId).toMatch(/^fc-/);
  });
});

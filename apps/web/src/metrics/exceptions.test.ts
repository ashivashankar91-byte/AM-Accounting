import { describe, it, expect, vi, afterEach } from 'vitest';
import { scheduleApi, glApi } from '../api/client';
import {
  loadScheduleVarianceExceptions,
  loadFloorplanTrustExceptions,
  loadUnpostedJournalEntryExceptions,
  loadCommandCenterExceptions,
} from './exceptions';

vi.mock('../api/client', () => ({
  scheduleApi: { getTieOuts: vi.fn() },
  glApi: { listFloorPlanUnits: vi.fn(), getEntries: vi.fn() },
}));

describe('loadScheduleVarianceExceptions', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns no exception when every tie-out row is MATCHED', async () => {
    (scheduleApi.getTieOuts as any).mockResolvedValue([
      { status: 'MATCHED', variance: 0, asOfDate: new Date().toISOString() },
    ]);
    const result = await loadScheduleVarianceExceptions();
    expect(result).toEqual([]);
  });

  it('surfaces a critical exception with total dollar variance and oldest age for DISCREPANCY rows', async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    (scheduleApi.getTieOuts as any).mockResolvedValue([
      { status: 'DISCREPANCY', variance: 1500, asOfDate: oldDate },
      { status: 'DISCREPANCY', variance: -320, asOfDate: new Date().toISOString() },
      { status: 'MATCHED', variance: 0, asOfDate: new Date().toISOString() },
    ]);
    const result = await loadScheduleVarianceExceptions();
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('CRITICAL');
    expect(result[0].category).toBe('SCHEDULE_VARIANCE');
    expect(result[0].count).toBe(2);
    expect(result[0].exposureAmount).toBe(1820);
    expect(result[0].oldestAgeDays).toBe(10);
    expect(result[0].drillThroughUrl).toContain('tab=tieout');
    expect(result[0].asOf).toBeTruthy();
    expect(result[0].dataFreshness).toBe('LIVE');
  });
});

describe('loadFloorplanTrustExceptions', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns no exception when no unit is sold-and-unpaid', async () => {
    (glApi.listFloorPlanUnits as any).mockResolvedValue({
      units: [{ vin: '1', current_balance: 25000, vehicle_status: 'IN_STOCK', payoff_date: null, floor_date: '2026-06-01' }],
    });
    const result = await loadFloorplanTrustExceptions();
    expect(result).toEqual([]);
  });

  it('flags units sold while still on an open floorplan payable, with total exposure', async () => {
    (glApi.listFloorPlanUnits as any).mockResolvedValue({
      units: [
        { vin: '1', current_balance: 25000, vehicle_status: 'SOLD', payoff_date: null, floor_date: '2026-06-01' },
        { vin: '2', current_balance: 47000, vehicle_status: 'SOLD', payoff_date: null, floor_date: '2026-05-01' },
        { vin: '3', current_balance: 30000, vehicle_status: 'SOLD', payoff_date: '2026-07-01' }, // already paid off
        { vin: '4', current_balance: 20000, vehicle_status: 'IN_STOCK', payoff_date: null },
      ],
    });
    const result = await loadFloorplanTrustExceptions();
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe('CRITICAL');
    expect(result[0].category).toBe('FLOORPLAN_TRUST');
    expect(result[0].count).toBe(2);
    expect(result[0].exposureAmount).toBe(72000);
    expect(result[0].drillThroughUrl).toBe('/recon?tab=floor-plan&filter=out-of-trust');
  });
});

describe('loadUnpostedJournalEntryExceptions', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('returns no exception when there are no drafts', async () => {
    (glApi.getEntries as any).mockResolvedValue([]);
    const result = await loadUnpostedJournalEntryExceptions();
    expect(result).toEqual([]);
  });

  it('escalates to CRITICAL above 5 drafts, WARNING otherwise', async () => {
    (glApi.getEntries as any).mockResolvedValue([
      { entryDate: new Date().toISOString(), lines: [{ debit: 1000 }] },
      { entryDate: new Date().toISOString(), lines: [{ debit: 2000 }] },
    ]);
    const result = await loadUnpostedJournalEntryExceptions();
    expect(result[0].severity).toBe('WARNING');
    expect(result[0].exposureAmount).toBe(3000);
    expect(result[0].count).toBe(2);
  });
});

describe('loadCommandCenterExceptions', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('aggregates all three categories sorted by severity and never fails the batch on one bad category', async () => {
    (scheduleApi.getTieOuts as any).mockRejectedValue(new Error('schedule-service unavailable'));
    (glApi.listFloorPlanUnits as any).mockResolvedValue({
      units: [{ vin: '1', current_balance: 10000, vehicle_status: 'SOLD', payoff_date: null, floor_date: '2026-06-01' }],
    });
    (glApi.getEntries as any).mockResolvedValue([
      { entryDate: new Date().toISOString(), lines: [{ debit: 500 }] },
    ]);

    const result = await loadCommandCenterExceptions();
    expect(result.failedCategories).toEqual(['SCHEDULE_VARIANCE']);
    expect(result.exceptions).toHaveLength(2);
    expect(result.exceptions[0].category).toBe('FLOORPLAN_TRUST'); // CRITICAL sorts first
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { configApi } from '../api/client';
import { resolveDashboardTargets } from './targets';

vi.mock('../api/client', () => ({
  configApi: { resolve: vi.fn(), listCatalog: vi.fn() },
}));

describe('resolveDashboardTargets', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('parses decimal, int, bool, enum, and list-shaped config values', async () => {
    (configApi.resolve as any).mockImplementation((key: string) => {
      const values: Record<string, string> = {
        'dashboard.absorption_target': '0.85',
        'dashboard.absorption_include_fi_gross': 'false',
        'dashboard.absorption_overhead_basis': 'total',
        'dashboard.days_supply_target_new': '60',
        'dashboard.contracts_in_transit_aging_buckets_days': '3,5,10,20',
      };
      if (key in values) {
        return Promise.resolve({ key, type: 'STRING', value: values[key], resolvedScope: 'TENANT' });
      }
      return Promise.resolve({ key, type: 'STRING', value: '0', resolvedScope: 'DEFAULT' });
    });

    const targets = await resolveDashboardTargets({ entityId: 'entity-kunes-delavan', storeId: null });

    expect(targets.absorptionTarget).toBe(0.85);
    expect(targets.absorptionIncludeFAndIGross).toBe(false);
    expect(targets.absorptionOverheadBasis).toBe('total');
    expect(targets.daysSupplyTargetNew).toBe(60);
    expect(targets.contractsInTransitAgingBucketsDays).toEqual([3, 5, 10, 20]);
  });

  it('leaves a field null (not 0) when its config key fails to resolve, without failing the whole batch', async () => {
    (configApi.resolve as any).mockImplementation((key: string) => {
      if (key === 'dashboard.absorption_target') return Promise.reject(new Error('network error'));
      return Promise.resolve({ key, type: 'STRING', value: '0.75', resolvedScope: 'TENANT' });
    });

    const targets = await resolveDashboardTargets({ entityId: 'entity-kunes-delavan', storeId: null });

    expect(targets.absorptionTarget).toBeNull();
    expect(targets.expenseToGrossTarget).toBe(0.75);
  });

  it('resolves an empty bucket list rather than throwing when a bucket key fails', async () => {
    (configApi.resolve as any).mockImplementation((key: string) => {
      if (key === 'dashboard.schedule_aging_buckets_days') return Promise.reject(new Error('unknown key'));
      return Promise.resolve({ key, type: 'STRING', value: '1', resolvedScope: 'TENANT' });
    });

    const targets = await resolveDashboardTargets({ entityId: 'entity-kunes-delavan', storeId: null });
    expect(targets.scheduleAgingBucketsDays).toEqual([]);
  });
});

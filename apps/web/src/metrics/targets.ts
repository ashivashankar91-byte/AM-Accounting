// AMACC dashboard rebuild — target/benchmark config resolution.
//
// Reads every dashboard.* key from the existing S223 config framework
// (config_key_catalog / config_setting, exposed at /api/v1/config/:key) and
// exposes a single typed `DashboardTargets` object for the metrics module
// and all 3 surfaces to consume. Per the build brief: "No hardcoded targets
// or benchmarks... Every threshold... reads from a per-tenant, per-entity...
// configuration table." No component may read a `dashboard.*` config key
// directly — everything routes through here so a missing/unresolvable key
// renders "target not set" instead of silently falling back to a guess.

import { configApi, type ResolvedConfigValue } from '../api/client';
import type { EntityScope } from './types';

export interface DashboardTargets {
  absorptionTarget: number | null;
  absorptionIncludeFAndIGross: boolean;
  absorptionOverheadBasis: 'total' | 'adjusted';
  expenseToGrossTarget: number | null;
  grossToNetTarget: number | null;
  personnelToGrossTarget: number | null;
  frontGrossPurTargetNew: number | null;
  frontGrossPurTargetUsed: number | null;
  fAndIPvrTarget: number | null;
  effectiveLaborRateTarget: number | null;
  hoursPerROTarget: number | null;
  elrBlendedMode: boolean;
  daysSupplyTargetNew: number | null;
  daysSupplyTargetUsed: number | null;
  contractsInTransitAgingBucketsDays: number[];
  scheduleAgingBucketsDays: number[];
  inventoryAgingBucketsDays: number[];
  partsObsolescenceBucketsMonths: number[];
  closeDaysRemainingWarning: number | null;
  warrantyClaimExpiryWarningDays: number | null;
  factoryStatementDueWarningDays: number | null;
  autoRefreshMinutes: number | null;
  autoRefreshMinutesGroup: number | null;
}

/** Every dashboard.* catalog key, mapped to its parser and field name. Kept
 * as a single table so adding a new target key is a one-line change here
 * plus the catalog migration — never scattered across surfaces. */
const KEY_MAP: Array<{
  key: string;
  field: keyof DashboardTargets;
  parse: (raw: string) => DashboardTargets[keyof DashboardTargets];
}> = [
  { key: 'dashboard.absorption_target', field: 'absorptionTarget', parse: parseFloatOrNull },
  { key: 'dashboard.absorption_include_fi_gross', field: 'absorptionIncludeFAndIGross', parse: parseBool },
  { key: 'dashboard.absorption_overhead_basis', field: 'absorptionOverheadBasis', parse: (v) => v as 'total' | 'adjusted' },
  { key: 'dashboard.expense_to_gross_target', field: 'expenseToGrossTarget', parse: parseFloatOrNull },
  { key: 'dashboard.gross_to_net_target', field: 'grossToNetTarget', parse: parseFloatOrNull },
  { key: 'dashboard.personnel_to_gross_target', field: 'personnelToGrossTarget', parse: parseFloatOrNull },
  { key: 'dashboard.front_gross_pur_target_new', field: 'frontGrossPurTargetNew', parse: parseFloatOrNull },
  { key: 'dashboard.front_gross_pur_target_used', field: 'frontGrossPurTargetUsed', parse: parseFloatOrNull },
  { key: 'dashboard.fi_pvr_target', field: 'fAndIPvrTarget', parse: parseFloatOrNull },
  { key: 'dashboard.effective_labor_rate_target', field: 'effectiveLaborRateTarget', parse: parseFloatOrNull },
  { key: 'dashboard.hours_per_ro_target', field: 'hoursPerROTarget', parse: parseFloatOrNull },
  { key: 'dashboard.elr_blended_mode', field: 'elrBlendedMode', parse: parseBool },
  { key: 'dashboard.days_supply_target_new', field: 'daysSupplyTargetNew', parse: parseFloatOrNull },
  { key: 'dashboard.days_supply_target_used', field: 'daysSupplyTargetUsed', parse: parseFloatOrNull },
  { key: 'dashboard.contracts_in_transit_aging_buckets_days', field: 'contractsInTransitAgingBucketsDays', parse: parseIntList },
  { key: 'dashboard.schedule_aging_buckets_days', field: 'scheduleAgingBucketsDays', parse: parseIntList },
  { key: 'dashboard.inventory_aging_buckets_days', field: 'inventoryAgingBucketsDays', parse: parseIntList },
  { key: 'dashboard.parts_obsolescence_buckets_months', field: 'partsObsolescenceBucketsMonths', parse: parseIntList },
  { key: 'dashboard.close_days_remaining_warning', field: 'closeDaysRemainingWarning', parse: parseFloatOrNull },
  { key: 'dashboard.warranty_claim_expiry_warning_days', field: 'warrantyClaimExpiryWarningDays', parse: parseFloatOrNull },
  { key: 'dashboard.factory_statement_due_warning_days', field: 'factoryStatementDueWarningDays', parse: parseFloatOrNull },
  { key: 'dashboard.auto_refresh_minutes', field: 'autoRefreshMinutes', parse: parseFloatOrNull },
  { key: 'dashboard.auto_refresh_minutes_group', field: 'autoRefreshMinutesGroup', parse: parseFloatOrNull },
];

function parseFloatOrNull(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseBool(raw: string): boolean {
  return raw === 'true';
}

function parseIntList(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
}

/**
 * Resolves every dashboard.* target/threshold key for the given entity
 * scope. STORE scope is preferred over ENTITY over TENANT per the existing
 * config framework's resolution order — callers pass whichever dimensions
 * are known; the backend resolves the rest.
 *
 * A key that fails to resolve (network error, unknown key) is left `null`
 * (or its list/bool default) rather than throwing, so one bad key can't
 * blank an entire dashboard — but the field is genuinely `null`, so
 * components must render "target not set", never a silent 0.
 */
export async function resolveDashboardTargets(scope: Pick<EntityScope, 'entityId' | 'storeId'>): Promise<DashboardTargets> {
  const results = await Promise.allSettled(
    KEY_MAP.map((entry) => configApi.resolve(entry.key, { entityId: scope.entityId, storeId: scope.storeId })),
  );

  const targets = {} as DashboardTargets;
  results.forEach((result, i) => {
    const entry = KEY_MAP[i];
    if (result.status === 'fulfilled') {
      (targets as any)[entry.field] = entry.parse((result.value as ResolvedConfigValue).value);
    } else {
      (targets as any)[entry.field] = entry.field.toLowerCase().includes('bucket') ? [] : null;
    }
  });
  return targets;
}

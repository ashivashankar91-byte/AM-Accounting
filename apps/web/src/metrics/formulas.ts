// AMACC dashboard rebuild — shared metric formulas.
//
// Every formula here implements exactly one row of the build brief's
// "Metric definitions — implement these exactly" table. Each function is
// pure (no I/O, no config lookups) — callers pass in already-resolved
// inputs (including config-sourced flags/targets), which keeps every
// formula trivially unit-testable and keeps this module the single source
// of truth regardless of which surface or config variant is calling it.
//
// Every formula returns `null` (never 0, never NaN, never a divide-by-zero
// throw) when its denominator is zero or an input is missing, so callers
// can render "not available" instead of a misleading zero.

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  return numerator / denominator;
}

// ── Absorption rate ─────────────────────────────────────────────────────
// Fixed ops gross (Service + Parts + Body) ÷ total dealership overhead
// expense. `includeFAndIGross` and `overheadBasis` are config-driven per
// the brief ("Config flag for whether F&I gross is included and whether
// overhead is total or adjusted. Default: exclude F&I, use total overhead.")
//
// PENDING SME CONFIRMATION: the "exclude F&I / total overhead" default
// (dashboard.absorption_include_fi_gross=false, dashboard.absorption_
// overhead_basis=total — see metrics/targets.ts) matches the brief's
// stated default but has not been confirmed by the accounting SME and is
// not yet consumed by any rendered surface (dead code outside its own
// unit tests as of this audit — see AUDIT.md A2). Do not change the
// default without SME sign-off; do not wire it into a surface without
// re-confirming the variant first.
export interface AbsorptionInput {
  serviceGross: number;
  partsGross: number;
  bodyShopGross: number;
  fAndIGross: number;
  totalOverheadExpense: number;
  adjustedOverheadExpense?: number;
  includeFAndIGross: boolean;
  overheadBasis: 'TOTAL' | 'ADJUSTED';
}

export function calcAbsorptionRate(input: AbsorptionInput): number | null {
  const fixedOpsGross =
    input.serviceGross + input.partsGross + input.bodyShopGross + (input.includeFAndIGross ? input.fAndIGross : 0);
  const overhead =
    input.overheadBasis === 'ADJUSTED' && input.adjustedOverheadExpense != null
      ? input.adjustedOverheadExpense
      : input.totalOverheadExpense;
  return safeDivide(fixedOpsGross, overhead);
}

// ── Front gross PUR (per unit retailed) ─────────────────────────────────
// Vehicle department gross ÷ retail units delivered. New/used computed
// separately by the caller (pass each department's gross/units in turn).
// Fleet and wholesale units must already be excluded from `retailUnits`
// by the caller — this function does not know about deal classification.
export function calcFrontGrossPUR(vehicleDeptGross: number, retailUnits: number): number | null {
  return safeDivide(vehicleDeptGross, retailUnits);
}

// ── F&I PVR (per vehicle retailed) ──────────────────────────────────────
// Total F&I gross ÷ total retail units (new + used, excl. fleet/wholesale).
// Always a dollar figure — see MetricUnit.CURRENCY; never render as %.
export function calcFAndIPVR(totalFAndIGross: number, totalRetailUnits: number): number | null {
  return safeDivide(totalFAndIGross, totalRetailUnits);
}

// ── Total gross per unit ────────────────────────────────────────────────
export function calcTotalGrossPerUnit(frontGross: number, fAndIGross: number, retailUnits: number): number | null {
  return safeDivide(frontGross + fAndIGross, retailUnits);
}

// ── Expense to gross ────────────────────────────────────────────────────
export function calcExpenseToGross(totalExpense: number, totalGross: number): number | null {
  return safeDivide(totalExpense, totalGross);
}

// ── Gross to net ────────────────────────────────────────────────────────
export function calcGrossToNet(netProfit: number, totalGross: number): number | null {
  return safeDivide(netProfit, totalGross);
}

// ── Personnel to gross ──────────────────────────────────────────────────
export function calcPersonnelToGross(totalPersonnelExpense: number, totalGross: number): number | null {
  return safeDivide(totalPersonnelExpense, totalGross);
}

// ── Effective labor rate ────────────────────────────────────────────────
// Customer-pay labor sales ÷ customer-pay labor hours by default; caller
// passes blended sales/hours instead when the blended-ELR config option is
// enabled — this function stays agnostic to which the caller chose.
export function calcEffectiveLaborRate(laborSales: number, laborHours: number): number | null {
  return safeDivide(laborSales, laborHours);
}

// ── Hours per RO ────────────────────────────────────────────────────────
export function calcHoursPerRO(totalFlaggedHours: number, closedROCount: number): number | null {
  return safeDivide(totalFlaggedHours, closedROCount);
}

// ── Days supply ─────────────────────────────────────────────────────────
// Current inventory units ÷ (retail units sold in trailing N days ÷ N).
// `trailingDays` (N) is config-driven — default 30 used / 60 new — passed
// in by the caller, never hardcoded here.
export function calcDaysSupply(currentInventoryUnits: number, unitsSoldTrailingNDays: number, trailingDays: number): number | null {
  const dailyRate = safeDivide(unitsSoldTrailingNDays, trailingDays);
  if (dailyRate == null) return null;
  return safeDivide(currentInventoryUnits, dailyRate);
}

// ── Parts obsolescence % ────────────────────────────────────────────────
// Value of parts with no sale in N months ÷ total parts inventory value.
// Bucket boundaries (6/9/12/24 months) are supplied by the caller from
// config — this function computes one bucket's % at a time.
export function calcPartsObsolescencePercent(noSaleValueInBucket: number, totalPartsInventoryValue: number): number | null {
  return safeDivide(noSaleValueInBucket, totalPartsInventoryValue);
}

// ── Floorplan trust position ────────────────────────────────────────────
// Units delivered/contracted but still on an open floorplan payable are
// "out of trust" — a covenant and legal event, never suppressed. This
// returns the raw exposure; severity/tile framing lives in the exception
// contract (ExceptionItem), not here.
export interface FloorplanTrustUnit {
  vin: string;
  currentBalance: number;
  deliveredOrContractDate: string | null;
  payoffDate: string | null;
}

export interface FloorplanTrustPosition {
  unitsOutOfTrust: FloorplanTrustUnit[];
  totalExposure: number;
  oldestAgeDays: number | null;
}

export function calcFloorplanTrustPosition(units: FloorplanTrustUnit[], asOf: Date): FloorplanTrustPosition {
  const outOfTrust = units.filter((u) => u.deliveredOrContractDate != null && u.payoffDate == null);
  const totalExposure = outOfTrust.reduce((sum, u) => sum + u.currentBalance, 0);
  const ages = outOfTrust
    .map((u) => (u.deliveredOrContractDate ? daysBetween(new Date(u.deliveredOrContractDate), asOf) : null))
    .filter((d): d is number => d != null);
  return {
    unitsOutOfTrust: outOfTrust,
    totalExposure,
    oldestAgeDays: ages.length ? Math.max(...ages) : null,
  };
}

// ── Contracts in transit aging ──────────────────────────────────────────
// Days between contract date and funding receipt, for unfunded deals.
// Bucket boundaries (3/5/10/20 days) supplied by caller from config.
export interface ContractInTransit {
  dealId: string;
  contractDate: string;
  fundedDate: string | null;
  unfundedAmount: number;
}

export interface ContractsInTransitAging {
  unfundedCount: number;
  unfundedTotal: number;
  oldestAgeDays: number | null;
  byBucket: Record<string, { count: number; amount: number }>;
}

export function calcContractsInTransitAging(
  contracts: ContractInTransit[],
  bucketBoundaries: number[],
  asOf: Date,
): ContractsInTransitAging {
  const unfunded = contracts.filter((c) => c.fundedDate == null);
  const ages = unfunded.map((c) => daysBetween(new Date(c.contractDate), asOf));
  // Boundaries describe the upper edge of each bucket (e.g. "buckets at 3, 5,
  // 10, 20 days" means 0-3 / 3-5 / 5-10 / 10-20 / 20+) — prepend an implicit
  // 0 so the youngest items (age below the first configured boundary) still
  // land in a bucket instead of being silently excluded from `byBucket`
  // while still counting toward `unfundedCount`/`unfundedTotal`.
  const sortedBoundaries = [0, ...bucketBoundaries].sort((a, b) => a - b);
  const byBucket: Record<string, { count: number; amount: number }> = {};
  for (let i = 0; i < sortedBoundaries.length; i++) {
    const lower = sortedBoundaries[i];
    const upper = sortedBoundaries[i + 1] ?? Infinity;
    const label = upper === Infinity ? `${lower}+` : `${lower}-${upper}`;
    const inBucket = unfunded.filter((c, idx) => ages[idx] >= lower && ages[idx] < upper);
    byBucket[label] = {
      count: inBucket.length,
      amount: inBucket.reduce((sum, c) => sum + c.unfundedAmount, 0),
    };
  }
  return {
    unfundedCount: unfunded.length,
    unfundedTotal: unfunded.reduce((sum, c) => sum + c.unfundedAmount, 0),
    oldestAgeDays: ages.length ? Math.max(...ages) : null,
    byBucket,
  };
}

// ── Schedule variance ───────────────────────────────────────────────────
// Sum of schedule sub-ledger detail − GL control account balance.
// Non-zero is ALWAYS an exception (never a rounding tolerance silently
// applied here — if a tenant wants a tolerance, that is a config-driven
// decision made by the caller before treating the result as "in balance").
export function calcScheduleVariance(scheduleDetailSum: number, glControlBalance: number): number {
  return scheduleDetailSum - glControlBalance;
}

// ── shared date helper ──────────────────────────────────────────────────
export function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((to.getTime() - from.getTime()) / msPerDay);
}

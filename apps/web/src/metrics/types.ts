// AMACC dashboard rebuild — shared metric type contract.
//
// Every dealership performance metric on every one of the 3 accounting
// surfaces (Command Center, Financial Dashboard, Group Dashboard) is
// computed by exactly one function in this module and rendered through
// this shape. Two surfaces must NEVER compute the same metric with two
// different formulas — that is the single most common failure mode in
// dealership analytics call out in the rebuild brief, and it is what
// destroys a controller's trust in the whole module.

/** A metric value alongside every comparator the value doctrine requires. */
export interface MetricResult {
  /** The computed value. `null` means "cannot be computed" (e.g. zero
   * denominator) — this must never silently render as 0. */
  value: number | null;
  /** Why `value` is null, if it is. Never swallowed silently. */
  unavailableReason?: string;
  /** Prior month's value for the same metric/scope, if available. */
  priorMonth?: number | null;
  /** Same month, prior year. */
  priorYearSameMonth?: number | null;
  /** Budget figure, if a budget exists for this tenant/entity/period. */
  budget?: number | null;
  /** Per-tenant/entity/OEM configured target (see targetConfig.ts). Distinct
   * from budget: a target is a standing goal (e.g. "12% absorption"),
   * a budget is a period-specific plan figure. */
  target?: number | null;
  /** Average of this metric across all rooftops in scope, for group
   * comparison views. Omitted on single-store surfaces. */
  groupAverage?: number | null;
}

/** Which numeric convention a metric renders under — most dealership
 * metrics are percentages or plain currency, but a few (PVR, PUR) are
 * always dollar figures and must never be accidentally rendered as a
 * percentage (the brief specifically flags F&I PVR misrendered as GP%). */
export type MetricUnit = 'CURRENCY' | 'PERCENT' | 'RATIO' | 'DAYS' | 'COUNT';

export interface MetricDefinition {
  key: string;
  label: string;
  unit: MetricUnit;
  /** Higher-is-better (absorption) vs lower-is-better (expense-to-gross,
   * days supply, aging). Drives directional coloring — never hardcode
   * "green = up" in a component; ask the metric. */
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
}

/** Severity levels for exception tiles — maps directly to the semantic
 * color rule in the build brief: red = money at risk / broken tie-out,
 * amber = deadline approaching, green = confirmed balanced. Never used
 * decoratively. */
export type ExceptionSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

/**
 * The one shape every exception tile on every surface must produce.
 * Directly mirrors the build brief's required API exception fields
 * (severity/category/count/exposure_amount/oldest_age_days/owner/reason/
 * resolution_hint/drill_through_url) so backend and frontend never drift.
 * A tile with no drillThroughUrl fails the brief's "action test" and must
 * not be built as a clickable tile — render it as a plain KPI instead.
 */
export interface ExceptionItem {
  severity: ExceptionSeverity;
  category: string;
  count: number;
  exposureAmount: number;
  oldestAgeDays: number | null;
  owner: string | null;
  reason: string;
  resolutionHint: string;
  drillThroughUrl: string;
  /** When the underlying data for this exception was fetched. Accounting
   * data is never real-time — every tile must render this honestly rather
   * than implying a live view (build brief non-negotiable). */
  asOf: string;
  /** Human-readable staleness label derived from `asOf` (e.g. "just now",
   * "12 min ago"). Computed at render time by the UI, not stored stale. */
  dataFreshness: 'LIVE' | 'RECENT' | 'STALE';
}

/** Standard entity scope every surface/API call must carry. `entityId` of
 * `null` is only valid when `consolidated` is explicitly true — there is no
 * other way to represent "no entity chosen" per the brief's non-negotiable
 * constraint that entity scope must never be reachably unset. */
export interface EntityScope {
  tenantId: string;
  entityId: string | null;
  storeId?: string | null;
  consolidated: boolean;
}

// CE-12 (S081) — pure sold-out-of-trust (SOT) exposure/escalation logic.
// A unit is "sold out of trust" when it has been delivered (sold) but its
// floorplan liability item is still unrelieved beyond a configured grace
// period — the dealership owes the lender for a unit it no longer has to
// sell. gracePeriodDays is a tenant-configurable SAFE_CONFIGURATION value
// (see FloorplanTenantConfig).
export type EscalationState = 'WATCH' | 'ESCALATED' | 'RESOLVED';

export interface SotEvaluationInput {
  deliveredAt: Date;
  now: Date;
  gracePeriodDays: number;
  /** True when the unit's floorplan liability item has been fully relieved
   * (status RELIEVED) — SOT exposure ends the moment the item closes. */
  itemRelieved: boolean;
}

export interface SotEvaluationResult {
  state: EscalationState;
  exposureDays: number;
  gracePeriodExceeded: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Computes the CURRENT escalation state for one delivered-unit / liability-
 * item pair. Pure function of (deliveredAt, now, gracePeriodDays,
 * itemRelieved) — no DB reads. application/sot-service.ts calls this on
 * every dashboard/aging query (not a background poller), so results are
 * always freshly computed against the live join of delivery events vs open
 * liability items, and persists the transition (with audit) only when the
 * computed state differs from the last-recorded state.
 */
export function evaluateSot(input: SotEvaluationInput): SotEvaluationResult {
  if (input.itemRelieved) {
    return { state: 'RESOLVED', exposureDays: 0, gracePeriodExceeded: false };
  }
  const exposureMs = input.now.getTime() - input.deliveredAt.getTime();
  const exposureDays = Math.max(0, Math.floor(exposureMs / MS_PER_DAY));
  const gracePeriodExceeded = exposureDays > input.gracePeriodDays;
  return {
    state: gracePeriodExceeded ? 'ESCALATED' : 'WATCH',
    exposureDays,
    gracePeriodExceeded,
  };
}

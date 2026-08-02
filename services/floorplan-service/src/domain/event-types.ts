// CE-12 — canonical eventType / packKey constants shared between the
// application services (event producers) and scripts/seed-ce12-rule-packs.ts
// (the rule packs that consume these exact eventTypes). Single source of
// truth so a typo can never desync the two sides.

export const EVENT_TYPES = {
  ADVANCE_MATCHED: 'floorplan.advance-matched.v1',
  PAYOFF_MATCHED: 'floorplan.payoff-matched.v1',
  BREAK_WRITEOFF: 'floorplan.break-writeoff.v1',
  INTEREST_ACCRUAL: 'floorplan.interest-accrual.v1',
  CURTAILMENT_PAYMENT: 'floorplan.curtailment-payment.v1',
} as const;

export const PACK_KEYS = {
  ADVANCE_MATCHED: 'ce12.floorplan-advance-matched',
  PAYOFF_MATCHED: 'ce12.floorplan-payoff-matched',
  BREAK_WRITEOFF: 'ce12.floorplan-break-writeoff',
  INTEREST_ACCRUAL: 'ce12.floorplan-interest-accrual',
  CURTAILMENT_PAYMENT: 'ce12.floorplan-curtailment-payment',
} as const;

export const EVENT_SCHEMA_VERSION = '1.0';

// CE-12 gap-close — schedule-service linkage (S080 tie-out authoritative
// source). "85" is this service's assigned schedule-service Schedule
// (title "Floorplan Advance Liability" / S080, GL account 19102 Floorplan
// Notes Payable). See scripts/seed-ce12-rule-packs.ts's test-tenant fixture
// path for the Schedule/GlAccount.scheduleCode wiring, and
// src/application/tie-out-service.ts for how this is consumed.
export const FLOORPLAN_SCHEDULE_NUMBER = '85';

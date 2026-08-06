-- CE-07 — single authoritative ledger decision. The posting engine no
-- longer posts through its own PostingService.post() (a second, non-
-- authoritative ledger) for rule-engine-driven events; it now calls
-- gl-service's existing, certified posting door via GlPostingBridge
-- (services/coa-service/src/application/gl-posting-bridge.ts). gl-service
-- has no idempotency mechanism of its own, so a short-lived claim status is
-- needed on posting_execution to make the (tenantId, eventId) unique
-- constraint the sole race-safe duplicate-prevention point for both a
-- brand-new event (POSTING_IN_PROGRESS) and a replay of an existing
-- execution (REPLAY_IN_PROGRESS). Both are transient — every code path that
-- sets them always transitions to a terminal status (POSTED/REJECTED/
-- FAILED/NO_RULE_MATCH) in the same request; a row observed in one of these
-- states past that window indicates a crashed request, not a steady state.
-- Additive only — no existing allowed value is removed.

ALTER TABLE "posting_execution" DROP CONSTRAINT "posting_execution_status_chk";
ALTER TABLE "posting_execution" ADD CONSTRAINT "posting_execution_status_chk" CHECK ("status" IN (
  'POSTED', 'NO_RULE_MATCH', 'IDENTITY_CONFLICT', 'REJECTED', 'FAILED',
  'POSTING_IN_PROGRESS', 'REPLAY_IN_PROGRESS'
));

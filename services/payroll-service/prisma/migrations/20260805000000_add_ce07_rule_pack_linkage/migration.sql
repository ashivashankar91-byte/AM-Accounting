-- fix(integration): tracks the shadow CE-07 (coa-service) posting-engine
-- rule-pack version ids this payroll rule-pack version's own lifecycle
-- drives (see services/payroll-service/src/infrastructure/ce07-rule-pack-registrar.ts).
-- Nullable/additive — a pre-existing row simply has no CE-07 registration
-- yet (deterministically refused at post-time until reconciled by
-- re-activating a new version), never a silent gap.
ALTER TABLE "payroll_rule_pack_version"
  ADD COLUMN IF NOT EXISTS "ce07_posted_version_id" TEXT,
  ADD COLUMN IF NOT EXISTS "ce07_reversed_version_id" TEXT;

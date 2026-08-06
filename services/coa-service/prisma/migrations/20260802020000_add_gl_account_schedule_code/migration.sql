-- CE-12 — additive, nullable schedule-service linkage on gl_account.
--
-- gl-service already has an equivalent scheduleCode column gating its own
-- JOURNAL_ENTRY_POSTED emission (services/gl-service's GlAccount model).
-- coa-service's posting-engine path (S019/S020) never had one, which is why
-- controlNumber/applyNumber were persisted on coa-service's own JournalLine
-- rows but never actually reached schedule-service — this migration plus
-- the corresponding posting-service.ts change closes that gap. Null by
-- default: no existing account or behavior is affected until a tenant
-- explicitly opts an account in via PATCH /accounts/:id.

ALTER TABLE "gl_account" ADD COLUMN "schedule_code" TEXT;

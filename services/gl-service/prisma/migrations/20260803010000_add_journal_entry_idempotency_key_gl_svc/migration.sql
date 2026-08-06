-- CE-07 — authoritative GL idempotency. PostingExecution in coa-service
-- (the S019/S020 posting engine's own claim row) was previously the ONLY
-- duplicate-protection layer for a rule-engine-driven posting; gl-service
-- itself had no idempotency mechanism of its own, so losing that row (crash,
-- manual deletion, out-of-band data loss) before a resubmit could create a
-- genuinely SECOND authoritative journal for the same canonical event. This
-- migration makes gl-service's own posting door authoritative for
-- idempotency too, independent of any caller's own bookkeeping.
--
-- Nullable column + PARTIAL unique index (not a plain @@unique, which Prisma
-- schema.prisma cannot express directly — hand-authored here, same pattern
-- already used elsewhere in this migration history for constraints outside
-- the schema DSL's expressiveness): every existing/legacy journal_entries
-- row has idempotency_key = NULL and is excluded from the uniqueness check,
-- so this is purely additive for callers that don't supply one.

ALTER TABLE "journal_entries" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "journal_entries_tenant_idempotency_key_unique"
  ON "journal_entries" ("tenant_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

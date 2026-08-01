-- S124: idempotency uniqueness must apply only to terminal/proceedable
-- results (CALCULATED, EXEMPT_APPLIED). Non-proceed evidence rows
-- (NOT_CONFIGURED, ENGINE_REJECTED, ENGINE_UNAVAILABLE) are stored one per
-- re-request attempt, each superseding the last via previous_result_id,
-- WITHOUT ever updating an existing row (INSERT-only immutability).
--
-- Replaces the blanket unique index from the init migration with:
--   1. a plain (non-unique) index for query performance, and
--   2. a partial unique index enforcing true uniqueness only for the
--      two statuses that represent a completed, proceedable calculation.

DROP INDEX IF EXISTS "tax_result_tenant_id_idempotency_key_key";

CREATE INDEX IF NOT EXISTS "tax_result_tenant_id_idempotency_key_idx"
  ON "tax_result"("tenant_id", "idempotency_key");

CREATE UNIQUE INDEX IF NOT EXISTS "tax_result_tenant_idempotency_final_key"
  ON "tax_result"("tenant_id", "idempotency_key")
  WHERE "status" IN ('CALCULATED', 'EXEMPT_APPLIED');

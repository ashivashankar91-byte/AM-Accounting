-- R0 Stabilization Phase 4: idempotency key for outbox-drainer deliveries.
-- Additive-only; audit_logs remains append-only (immutable trigger unchanged).
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "source_event_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "audit_logs_source_event_id_key" ON "audit_logs" ("source_event_id");

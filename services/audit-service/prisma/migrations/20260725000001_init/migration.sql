-- FINAL-R0 Foundation Completion: same class of bug as
-- services/auth-service/prisma/migrations/20260724000001_init — the
-- `audit_logs` table was created in every prior dev environment via an
-- un-tracked `prisma db push`, never captured as a migration. Every later
-- migration (20260726000001_add_source_event_id) assumed it already existed,
-- so `prisma migrate deploy` on a brand-new database failed with
-- `relation "audit_logs" does not exist`. This baseline migration restores
-- the missing first step, matching the `AuditLog` model already in
-- schema.prisma (unchanged by this migration).

CREATE TABLE "audit_logs" (
    "id"             TEXT NOT NULL,
    "tenant_id"      TEXT NOT NULL,
    "event_type"     TEXT NOT NULL,
    "entity_type"    TEXT NOT NULL,
    "entity_id"      TEXT NOT NULL,
    "actor_type"     TEXT NOT NULL,
    "actor_id"       TEXT NOT NULL,
    "actor_name"     TEXT NOT NULL,
    "action"         TEXT NOT NULL,
    "previous_state" JSONB,
    "new_state"      JSONB,
    "reason"         TEXT,
    "confidence"     DOUBLE PRECISION,
    "metadata"       JSONB,
    "occurred_at"    TIMESTAMP(3) NOT NULL,
    "ip_address"     TEXT,
    "session_id"     TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");
CREATE INDEX "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");
CREATE INDEX "audit_logs_tenant_id_event_type_idx" ON "audit_logs"("tenant_id", "event_type");

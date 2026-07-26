-- Migration: 20250722000001_add_legal_entity
-- Additive only — creates new tables, does not alter existing ones.
-- Apply with: cd services/tenant-service && npx prisma migrate deploy
-- Or for local dev: npx prisma db push

-- ── legal_entities ───────────────────────────────────────────────────────────
CREATE TABLE "legal_entities" (
    "id"                   TEXT          NOT NULL,
    "tenant_id"            TEXT          NOT NULL,
    "entity_code"          TEXT          NOT NULL,
    "legal_name"           TEXT          NOT NULL,
    "display_name"         TEXT,
    "statutory_id"         TEXT,
    "functional_currency"  TEXT          NOT NULL DEFAULT 'USD',
    "country"              TEXT          NOT NULL DEFAULT 'US',
    "fiscal_year_end_month" SMALLINT     NOT NULL DEFAULT 12,
    "address"              TEXT,
    "city"                 TEXT,
    "state"                TEXT,
    "postal_code"          TEXT,
    "status"               TEXT          NOT NULL DEFAULT 'ACTIVE',
    "effective_date"       DATE          NOT NULL,
    "version"              INTEGER       NOT NULL DEFAULT 1,
    "has_posted_journals"  BOOLEAN       NOT NULL DEFAULT false,
    "deactivated_at"       TIMESTAMPTZ,
    "deactivated_by"       TEXT,
    "deactivation_reason"  TEXT,
    "created_at"           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "legal_entities_tenant_id_entity_code_key"
    ON "legal_entities"("tenant_id", "entity_code");

CREATE INDEX "legal_entities_tenant_id_idx"
    ON "legal_entities"("tenant_id");

CREATE INDEX "legal_entities_tenant_id_status_idx"
    ON "legal_entities"("tenant_id", "status");

-- ── tenant_outbox_events ─────────────────────────────────────────────────────
CREATE TABLE "tenant_outbox_events" (
    "id"           TEXT        NOT NULL,
    "tenant_id"    TEXT        NOT NULL,
    "event_type"   TEXT        NOT NULL,
    "aggregate_id" TEXT        NOT NULL,
    "payload"      JSONB       NOT NULL,
    "published_at" TIMESTAMPTZ,
    "retry_count"  INTEGER     NOT NULL DEFAULT 0,
    "last_error"   TEXT,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "tenant_outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_outbox_events_published_at_retry_count_idx"
    ON "tenant_outbox_events"("published_at", "retry_count");

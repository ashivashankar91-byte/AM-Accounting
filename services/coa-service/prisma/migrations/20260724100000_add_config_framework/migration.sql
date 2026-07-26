-- ════════════════════════════════════════════════════════════════════════════
-- S223 — Configuration Framework (Epic CE-01, Release R0)
-- Additive migration only. No destructive DDL. Idempotent (IF NOT EXISTS).
-- Hosted in coa-service (promoted from in-memory prototype to Prisma-backed).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Catalog of allowed configuration keys (BR223-4 catalog-controlled) ────────
CREATE TABLE IF NOT EXISTS "config_key_catalog" (
  "key"           TEXT PRIMARY KEY,
  "type"          TEXT NOT NULL,               -- BOOL | INT | ENUM | STRING
  "allowed_scope" TEXT[] NOT NULL,             -- subset of TENANT | ENTITY | STORE
  "enum_values"   TEXT[] NOT NULL DEFAULT '{}',-- only meaningful for type=ENUM
  "default_value" TEXT NOT NULL,
  "description"   TEXT NOT NULL,
  "since_version" TEXT NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ── Scoped, effective-dated setting value versions ───────────────────────────
CREATE TABLE IF NOT EXISTS "config_setting" (
  "id"             TEXT PRIMARY KEY,
  "tenant_id"      TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "type"           TEXT NOT NULL,
  "scope"          TEXT NOT NULL,              -- TENANT | ENTITY | STORE
  "entity_id"      TEXT,
  "store_id"       TEXT,
  "value"          TEXT NOT NULL,
  "effective_from" TIMESTAMP(3) NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED | EFFECTIVE | SUPERSEDED
  "actor"          TEXT NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at"  TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "config_setting_tenant_key_idx"        ON "config_setting" ("tenant_id", "key");
CREATE INDEX IF NOT EXISTS "config_setting_tenant_key_scope_idx"  ON "config_setting" ("tenant_id", "key", "scope", "entity_id", "store_id");
CREATE INDEX IF NOT EXISTS "config_setting_effective_from_idx"    ON "config_setting" ("effective_from");

-- ── AuditPort stub outbox (shared table; idempotent create) ──────────────────
CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "doc_type"     TEXT NOT NULL,
  "doc_id"       TEXT NOT NULL,
  "action"       TEXT NOT NULL,
  "before"       JSONB,
  "after"        JSONB,
  "actor"        TEXT NOT NULL,
  "published_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_outbox_publish_idx" ON "audit_outbox" ("published_at");

-- ── Domain-event outbox for coa-service ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "coa_outbox_events" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "event_type"   TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "published_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "coa_outbox_publish_idx" ON "coa_outbox_events" ("published_at");

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — interim R0 config-key catalog.
--   je.posting_mode        : governs S013 posting flow (direct vs agent review).
--   fiscal.max_open_periods: consumed by S209 (max concurrently OPEN periods).
-- UQ-22 gates seeding of legacy GlSystemConfig semantics; those keys are added
-- when the field-semantics question is resolved. The framework itself is not
-- blocked (packet §16).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO "config_key_catalog"
  ("key", "type", "allowed_scope", "enum_values", "default_value", "description", "since_version")
VALUES
  ('je.posting_mode', 'ENUM', ARRAY['TENANT','ENTITY','STORE'], ARRAY['direct','review'],
   'direct', 'Journal-entry posting mode: direct posting or agent-review gate (S013).', '1.0.0'),
  ('fiscal.max_open_periods', 'INT', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '2', 'Maximum number of concurrently OPEN accounting periods per entity (S209).', '1.0.0')
ON CONFLICT ("key") DO NOTHING;

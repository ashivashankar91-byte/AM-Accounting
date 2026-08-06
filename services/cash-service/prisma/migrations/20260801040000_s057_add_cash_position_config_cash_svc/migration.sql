-- S057 — Daily Cash Position Dashboard: statutory large-cash-transaction
-- threshold config (empty table = no flags, never guessed) and an audited
-- export-record table. Additive only.

CREATE TABLE "large_cash_threshold_config" (
  "id"               TEXT PRIMARY KEY,
  "tenant_id"        TEXT NOT NULL,
  "jurisdiction"     TEXT NOT NULL,
  "threshold_amount" NUMERIC(15,2) NOT NULL,
  "currency"         VARCHAR(3) NOT NULL DEFAULT 'USD',
  "updated_by"       TEXT NOT NULL,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "large_cash_threshold_config_tenant_id_jurisdiction_key" ON "large_cash_threshold_config" ("tenant_id", "jurisdiction");

CREATE TABLE "cash_position_export" (
  "id"            TEXT PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "entity_id"     TEXT NOT NULL,
  "business_date" DATE NOT NULL,
  "requested_by"  TEXT NOT NULL,
  "requested_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "snapshot"      JSONB NOT NULL
);
CREATE INDEX "cash_position_export_tenant_id_entity_id_business_date_idx" ON "cash_position_export" ("tenant_id", "entity_id", "business_date");

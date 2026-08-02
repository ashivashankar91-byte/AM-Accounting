-- S056 — ZBA Sweeps & FP-Offset Allocation. Additive only.

CREATE TABLE "sweep_account_pair_config" (
  "id"                     TEXT PRIMARY KEY,
  "tenant_id"              TEXT NOT NULL,
  "entity_id"              TEXT NOT NULL,
  "store_account_code"     TEXT NOT NULL,
  "operating_account_code" TEXT NOT NULL,
  "active"                 BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by"             TEXT NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "sweep_account_pair_config_tenant_id_store_account_code_operating_account_code_key"
  ON "sweep_account_pair_config" ("tenant_id", "store_account_code", "operating_account_code");

CREATE TABLE "zba_sweep" (
  "id"                 TEXT PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "pair_config_id"     TEXT NOT NULL REFERENCES "sweep_account_pair_config"("id"),
  "sweep_date"         DATE NOT NULL,
  "direction"          TEXT NOT NULL,
  "amount"             NUMERIC(15,2) NOT NULL,
  "confirmation_state" TEXT NOT NULL DEFAULT 'MANUAL_RECORDED',
  "status"             TEXT NOT NULL DEFAULT 'RECORDED',
  "idempotency_key"    TEXT NOT NULL,
  "recorded_by"        TEXT NOT NULL,
  "recorded_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at"          TIMESTAMP(3),
  "version"            INTEGER NOT NULL DEFAULT 1,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "zba_sweep_tenant_id_idempotency_key_key" ON "zba_sweep" ("tenant_id", "idempotency_key");
CREATE INDEX "zba_sweep_tenant_id_status_idx" ON "zba_sweep" ("tenant_id", "status");
-- AC: sweep amount must be strictly positive — the journal pair nets to zero
-- across the two accounts by construction (equal debit/credit legs), never
-- by a zero-amount no-op sweep.
ALTER TABLE "zba_sweep" ADD CONSTRAINT "zba_sweep_amount_positive_check" CHECK ("amount" > 0);

CREATE TABLE "fp_offset_allocation" (
  "id"               TEXT PRIMARY KEY,
  "tenant_id"        TEXT NOT NULL,
  "entity_id"        TEXT NOT NULL,
  "lender_name"      TEXT NOT NULL,
  "statement_date"   DATE NOT NULL,
  "statement_amount" NUMERIC(15,2) NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'DRAFT',
  "idempotency_key"  TEXT NOT NULL,
  "entered_by"       TEXT NOT NULL,
  "entered_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_at"        TIMESTAMP(3),
  "version"          INTEGER NOT NULL DEFAULT 1,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "fp_offset_allocation_tenant_id_idempotency_key_key" ON "fp_offset_allocation" ("tenant_id", "idempotency_key");

CREATE TABLE "fp_offset_allocation_line" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "allocation_id"     TEXT NOT NULL REFERENCES "fp_offset_allocation"("id"),
  "floorplan_unit_ref" TEXT NOT NULL,
  "amount"            NUMERIC(15,2) NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "fp_offset_allocation_line_tenant_id_allocation_id_idx" ON "fp_offset_allocation_line" ("tenant_id", "allocation_id");

-- S055 — Merchant Settlement Reconciliation. Additive only.

CREATE TABLE "settlement_batch" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "entity_id"         TEXT NOT NULL,
  "bank_account_code" TEXT NOT NULL,
  "processor_name"    TEXT NOT NULL,
  "batch_reference"   TEXT NOT NULL,
  "settlement_date"   DATE NOT NULL,
  "currency"          VARCHAR(3) NOT NULL DEFAULT 'USD',
  "gross_amount"      NUMERIC(15,2) NOT NULL,
  "fee_amount"        NUMERIC(15,2) NOT NULL,
  "net_amount"        NUMERIC(15,2) NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'IMPORTED',
  "idempotency_key"   TEXT NOT NULL,
  "imported_by"       TEXT NOT NULL,
  "imported_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_by"         TEXT,
  "posted_at"         TIMESTAMP(3),
  "version"           INTEGER NOT NULL DEFAULT 1,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "settlement_batch_tenant_id_idempotency_key_key" ON "settlement_batch" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "settlement_batch_tenant_id_processor_name_batch_reference_key" ON "settlement_batch" ("tenant_id", "processor_name", "batch_reference");
CREATE INDEX "settlement_batch_tenant_id_status_idx" ON "settlement_batch" ("tenant_id", "status");
-- AC: gross - fees = net provable per batch.
ALTER TABLE "settlement_batch" ADD CONSTRAINT "settlement_batch_gross_fee_net_check"
  CHECK ("gross_amount" - "fee_amount" = "net_amount");

CREATE TABLE "settlement_batch_line" (
  "id"          TEXT PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "batch_id"    TEXT NOT NULL REFERENCES "settlement_batch"("id"),
  "receipt_id"  TEXT,
  "deposit_id"  TEXT,
  "amount"      NUMERIC(15,2) NOT NULL,
  "matched_by"  TEXT NOT NULL,
  "matched_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "settlement_batch_line_tenant_id_batch_id_idx" ON "settlement_batch_line" ("tenant_id", "batch_id");

CREATE TABLE "settlement_worklist_item" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "batch_id"          TEXT,
  "bank_account_code" TEXT NOT NULL,
  "amount"            NUMERIC(15,2) NOT NULL,
  "card_last4"        TEXT,
  "transaction_ref"   TEXT,
  "status"            TEXT NOT NULL DEFAULT 'OPEN',
  "resolved_by"       TEXT,
  "resolved_at"       TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "settlement_worklist_item_tenant_id_status_idx" ON "settlement_worklist_item" ("tenant_id", "status");

CREATE TABLE "settlement_chargeback" (
  "id"                  TEXT PRIMARY KEY,
  "tenant_id"           TEXT NOT NULL,
  "batch_id"            TEXT REFERENCES "settlement_batch"("id"),
  "entity_id"           TEXT NOT NULL,
  "customer_id"         TEXT,
  "amount"              NUMERIC(15,2) NOT NULL,
  "reason_code"         TEXT,
  "status"              TEXT NOT NULL DEFAULT 'INTAKE',
  "disposition_action"  TEXT,
  "dispositioned_by"    TEXT,
  "dispositioned_at"    TIMESTAMP(3),
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "settlement_chargeback_tenant_id_status_idx" ON "settlement_chargeback" ("tenant_id", "status");

-- AC: each chargeback creates its dispositioned item exactly once — the
-- unique FK below is the DB-level guarantee (one adjustment per chargeback).
CREATE TABLE "settlement_adjustment" (
  "id"                 TEXT PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "chargeback_id"      TEXT NOT NULL UNIQUE REFERENCES "settlement_chargeback"("id"),
  "entity_id"          TEXT NOT NULL,
  "amount"             NUMERIC(15,2) NOT NULL,
  "disposition_action" TEXT NOT NULL,
  "ar_item_reference"  TEXT,
  "created_by"         TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

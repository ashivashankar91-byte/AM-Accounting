-- S053 — Deposit Workflow & Bank Feed Match. Additive only. New table names
-- checked unique across the repository. Money columns NUMERIC(15,2) per
-- CLAUDE.md's non-negotiable rule.

CREATE TABLE "cash_deposit" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "entity_id"         TEXT NOT NULL,
  "store_id"          TEXT NOT NULL,
  "bank_account_code" TEXT NOT NULL,
  "business_date"     DATE NOT NULL,
  "currency"          VARCHAR(3) NOT NULL DEFAULT 'USD',
  "status"            TEXT NOT NULL DEFAULT 'OPEN',
  "total_amount"      NUMERIC(15,2) NOT NULL,
  "idempotency_key"   TEXT NOT NULL,
  "prepared_by"       TEXT NOT NULL,
  "prepared_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "posted_by"         TEXT,
  "posted_at"         TIMESTAMP(3),
  "voided_by"         TEXT,
  "voided_at"         TIMESTAMP(3),
  "void_reason"       TEXT,
  "version"           INTEGER NOT NULL DEFAULT 1,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "cash_deposit_tenant_id_idempotency_key_key" ON "cash_deposit" ("tenant_id", "idempotency_key");
CREATE INDEX "cash_deposit_tenant_id_store_id_business_date_idx" ON "cash_deposit" ("tenant_id", "store_id", "business_date");
CREATE INDEX "cash_deposit_tenant_id_status_idx" ON "cash_deposit" ("tenant_id", "status");

CREATE TABLE "cash_deposit_line" (
  "id"          TEXT PRIMARY KEY,
  "tenant_id"   TEXT NOT NULL,
  "deposit_id"  TEXT NOT NULL REFERENCES "cash_deposit"("id"),
  "receipt_id"  TEXT NOT NULL,
  "tender_type" TEXT NOT NULL,
  "amount"      NUMERIC(15,2) NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- BR: a receipt can never be deposited twice — DB-level guard, not just app logic.
CREATE UNIQUE INDEX "cash_deposit_line_tenant_id_receipt_id_key" ON "cash_deposit_line" ("tenant_id", "receipt_id");
CREATE INDEX "cash_deposit_line_tenant_id_deposit_id_idx" ON "cash_deposit_line" ("tenant_id", "deposit_id");

CREATE TABLE "bank_feed_line" (
  "id"                 TEXT PRIMARY KEY,
  "tenant_id"          TEXT NOT NULL,
  "bank_account_code"  TEXT NOT NULL,
  "source"             TEXT NOT NULL DEFAULT 'MANUAL',
  "external_id"        TEXT,
  "amount"             NUMERIC(15,2) NOT NULL,
  "value_date"         DATE NOT NULL,
  "description"        TEXT,
  "status"             TEXT NOT NULL DEFAULT 'UNMATCHED',
  "matched_deposit_id" TEXT,
  "matched_receipt_id" TEXT,
  "matched_by"         TEXT,
  "matched_at"         TIMESTAMP(3),
  "imported_by"        TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "bank_feed_line_tenant_id_bank_account_code_external_id_key" ON "bank_feed_line" ("tenant_id", "bank_account_code", "external_id");
CREATE INDEX "bank_feed_line_tenant_id_status_idx" ON "bank_feed_line" ("tenant_id", "status");
CREATE INDEX "bank_feed_line_tenant_id_bank_account_code_idx" ON "bank_feed_line" ("tenant_id", "bank_account_code");

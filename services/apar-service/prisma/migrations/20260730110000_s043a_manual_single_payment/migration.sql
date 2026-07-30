-- AMACC-CH04 S043A: Manual Single Payment.
--
-- S043A is registered in the Fable canonical registry only as a summary row
-- (id S043A, epic CE-09, R2, L1). Original intake S043 was SPLIT into
-- S043A + S043B (payment runs/rails, out of scope here). Pays exactly one
-- APPROVED VendorInvoice in full by check — no partial/split payment is
-- introduced. Reuses the existing S3-09 ap_bank_accounts check-number
-- sequence — no parallel bank-account system.

-- S043A: link a bank account to the GL account it posts to (needed for the
-- Cr Bank side of a manual payment's GL entry). Additive/nullable — did not
-- exist before this migration.
ALTER TABLE "ap_bank_accounts" ADD COLUMN IF NOT EXISTS "gl_account_id" TEXT;

CREATE TABLE IF NOT EXISTS "ap_manual_payments" (
  "id"                      TEXT NOT NULL,
  "tenant_id"                TEXT NOT NULL,
  "invoice_id"                TEXT NOT NULL,
  "vendor_id"                 TEXT NOT NULL,
  "bank_account_id"           TEXT NOT NULL,
  "check_number"              INTEGER NOT NULL,
  "payment_date"              DATE NOT NULL DEFAULT CURRENT_DATE,
  "amount"                    DECIMAL(15,2) NOT NULL,
  "status"                    TEXT NOT NULL DEFAULT 'POSTED',
  "gl_entry_id"               TEXT,
  "gl_posting_error"          TEXT,
  "schedule_relief_status"    TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
  "schedule_id"               TEXT,
  "schedule_application_id"   TEXT,
  "schedule_relief_error"     TEXT,
  "version"                   INTEGER NOT NULL DEFAULT 1,
  "voided_at"                 TIMESTAMP(3),
  "voided_by"                 TEXT,
  "void_reason"               TEXT,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"                TEXT,

  CONSTRAINT "ap_manual_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_manual_payments_invoice_id_key" ON "ap_manual_payments"("invoice_id");
CREATE INDEX IF NOT EXISTS "ap_manual_payments_tenant_id_idx" ON "ap_manual_payments"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_manual_payments_tenant_id_vendor_id_idx" ON "ap_manual_payments"("tenant_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "ap_manual_payments_tenant_id_status_idx" ON "ap_manual_payments"("tenant_id", "status");

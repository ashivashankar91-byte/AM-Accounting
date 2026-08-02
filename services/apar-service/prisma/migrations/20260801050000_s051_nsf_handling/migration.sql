-- CE-09 S051: NSF (returned-payment) Handling.
--
-- Reverses the original receipt application (restores the AR entry to
-- OPEN) unless the originating deposit is already reconciled — in which
-- case the AR entry is NEVER mutated/reopened; the NSF instead posts as a
-- new bank-side adjustment event (postedAsBankAdjustment=true). Same
-- conservation boundary as S045 void-after-cleared.
--
-- Optional NSF fee AR item creation, per-tenant SAFE_CONFIGURATION fee
-- amount (missing config = no fee item, never a fabricated amount).
--
-- Customer.nsf_count / nsf_hold_set_at already exist from an earlier
-- schema pass (part of the S042 commit) — no ALTER needed here.

ALTER TABLE "ar_entries" ADD COLUMN IF NOT EXISTS "reconciled_at" TIMESTAMP(3);
ALTER TABLE "ar_entries" ADD COLUMN IF NOT EXISTS "reconciled_by" TEXT;

CREATE TABLE IF NOT EXISTS "ar_nsf_events" (
  "id"                         TEXT NOT NULL,
  "tenant_id"                  TEXT NOT NULL,
  "customer_id"                TEXT NOT NULL,
  "original_ar_entry_id"       TEXT NOT NULL,
  "amount"                     DECIMAL(15,2) NOT NULL,
  "reason"                     TEXT NOT NULL,
  "source"                     TEXT NOT NULL DEFAULT 'MANUAL',
  "deposit_reconciled"         BOOLEAN NOT NULL DEFAULT false,
  "posted_as_bank_adjustment"  BOOLEAN NOT NULL DEFAULT false,
  "fee_ar_entry_id"            TEXT,
  "fee_amount"                 DECIMAL(15,2),
  "gl_entry_id"                TEXT,
  "gl_posting_error"           TEXT,
  "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"                 TEXT,

  CONSTRAINT "ar_nsf_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ar_nsf_events_tenant_id_idx" ON "ar_nsf_events"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_nsf_events_tenant_id_customer_id_idx" ON "ar_nsf_events"("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "ar_nsf_events_tenant_id_original_ar_entry_id_idx" ON "ar_nsf_events"("tenant_id", "original_ar_entry_id");

-- SAFE_CONFIGURATION: missing row = no fee item is ever created.
CREATE TABLE IF NOT EXISTS "ar_nsf_fee_configs" (
  "tenant_id"  TEXT NOT NULL,
  "fee_amount" DECIMAL(15,2) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ar_nsf_fee_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- SAFE_CONFIGURATION: missing row = no auto-hold behavior ever applied.
CREATE TABLE IF NOT EXISTS "ar_nsf_hold_configs" (
  "tenant_id"        TEXT NOT NULL,
  "hold_after_count" INTEGER NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ar_nsf_hold_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- "Matrix row" GL account configuration — blank until Accounting
-- configures it (ACCOUNT_MAPPING_VALUES_PENDING pattern).
CREATE TABLE IF NOT EXISTS "ar_nsf_gl_account_configs" (
  "tenant_id"                  TEXT NOT NULL,
  "ar_control_gl_account_id"   TEXT,
  "cash_gl_account_id"         TEXT,
  "nsf_fee_income_gl_account_id" TEXT,
  "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                 TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ar_nsf_gl_account_configs_pkey" PRIMARY KEY ("tenant_id")
);

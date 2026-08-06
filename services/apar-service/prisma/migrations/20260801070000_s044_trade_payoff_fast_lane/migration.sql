-- CE-09 S044: Trade-Payoff Fast Lane.
--
-- Expedited payment path for vehicle trade lien payoffs. The payee is a
-- one-time "payee-for-deal" capture (name / remit address / reference) —
-- NOT necessarily a mastered Vendor row, so this table intentionally has
-- no FK to vendors. Amount and good-through date are entered verbatim from
-- the payoff quote; the system computes nothing actuarial/per-diem.
--
-- GL posting follows the blank-matrix-row / ACCOUNT_MAPPING_VALUES_PENDING
-- convention (see ap_use_tax_gl_account_configs precedent from S042):
-- ap_trade_payoff_gl_account_configs holds one nullable clearing-account
-- id per tenant, filled in blank here and only ever populated by a real
-- tenant's own configuration — never a real/production GL account number
-- hardcoded by engineering.

CREATE TABLE IF NOT EXISTS "ap_trade_payoff_payments" (
  "id"                    TEXT NOT NULL,
  "tenant_id"             TEXT NOT NULL,
  -- PUTR: reference-only field for future CE-12 consumption — no CE-12
  -- logic exists or is invoked here.
  "deal_reference"        TEXT NOT NULL,
  "payee_name"             TEXT NOT NULL,
  "payee_remit_address"    TEXT NOT NULL,
  "payee_reference"        TEXT,
  "amount"                 DECIMAL(15,2) NOT NULL,
  "good_through_date"      DATE NOT NULL,
  "reconfirmed_amount"     DECIMAL(15,2),
  "reconfirmed_by"         TEXT,
  "reconfirmed_at"         TIMESTAMP(3),
  "bank_account_id"        TEXT NOT NULL,
  "check_number"           INTEGER,
  "status"                 TEXT NOT NULL DEFAULT 'POSTED',
  "gl_entry_id"            TEXT,
  "gl_posting_error"       TEXT,
  "created_by"             TEXT NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_trade_payoff_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ap_trade_payoff_payments_tenant_id_idx" ON "ap_trade_payoff_payments"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_trade_payoff_payments_tenant_id_deal_reference_idx" ON "ap_trade_payoff_payments"("tenant_id", "deal_reference");

CREATE TABLE IF NOT EXISTS "ap_trade_payoff_gl_account_configs" (
  "tenant_id"                  TEXT NOT NULL,
  "payoff_clearing_gl_account_id" TEXT,
  "updated_at"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_trade_payoff_gl_account_configs_pkey" PRIMARY KEY ("tenant_id")
);

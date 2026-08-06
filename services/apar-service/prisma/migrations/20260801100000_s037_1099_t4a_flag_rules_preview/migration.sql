-- CE-09 S037: 1099/T4A Flag Rules & Preview.
--
-- Per-vendor 1099/T4A flag rules (form type + box/class code, per tax
-- year), a jurisdiction statutory threshold configuration table (tenant
-- config — SAFE_CONFIGURATION, never hardcoded in code), and an audited
-- corrections workflow layered on top of a year-preview that is always
-- computed live from posted payments (ApManualPayment) — never cached in
-- a way that could drift from the underlying ledger, so preview totals
-- reconcile byte-exactly to posted payments (AC).
--
-- Actual e-filing transmission is explicitly EXCLUDED from this epic
-- (compliance-vendor scope) — no table or code here attempts it.

CREATE TABLE IF NOT EXISTS "ap_1099_vendor_box_rules" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "vendor_id"   TEXT NOT NULL,
  "tax_year"    INTEGER NOT NULL,
  -- 1099-MISC | 1099-NEC | T4A
  "form_type"   TEXT NOT NULL,
  "box_code"    TEXT NOT NULL,
  "created_by"  TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_1099_vendor_box_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ap_1099_vendor_box_rules_tenant_id_idx" ON "ap_1099_vendor_box_rules"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_1099_vendor_box_rules_tenant_id_vendor_id_idx" ON "ap_1099_vendor_box_rules"("tenant_id", "vendor_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ap_1099_vendor_box_rules_tenant_vendor_year_form_key" ON "ap_1099_vendor_box_rules"("tenant_id", "vendor_id", "tax_year", "form_type");

CREATE TABLE IF NOT EXISTS "ap_1099_threshold_configs" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "form_type"       TEXT NOT NULL,
  "tax_year"        INTEGER NOT NULL,
  "threshold_amount" DECIMAL(15,2) NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_1099_threshold_configs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ap_1099_threshold_configs_tenant_id_idx" ON "ap_1099_threshold_configs"("tenant_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ap_1099_threshold_configs_tenant_form_year_key" ON "ap_1099_threshold_configs"("tenant_id", "form_type", "tax_year");

CREATE TABLE IF NOT EXISTS "ap_1099_corrections" (
  "id"               TEXT NOT NULL,
  "tenant_id"        TEXT NOT NULL,
  "vendor_id"        TEXT NOT NULL,
  "tax_year"         INTEGER NOT NULL,
  "form_type"        TEXT NOT NULL,
  "original_amount"  DECIMAL(15,2) NOT NULL,
  "corrected_amount" DECIMAL(15,2) NOT NULL,
  "reason"           TEXT NOT NULL,
  "created_by"       TEXT NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_1099_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ap_1099_corrections_tenant_id_idx" ON "ap_1099_corrections"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_1099_corrections_tenant_id_vendor_id_tax_year_idx" ON "ap_1099_corrections"("tenant_id", "vendor_id", "tax_year");

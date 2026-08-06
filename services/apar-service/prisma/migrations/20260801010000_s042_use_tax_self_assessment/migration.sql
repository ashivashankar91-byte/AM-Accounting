-- CE-09 S042: Use-Tax Self-Assessment.
--
-- When a taxable purchase invoice lacks vendor-charged tax, a clerk flags
-- it for use-tax self-assessment: an accrual journal (use-tax expense Dr /
-- use-tax payable Cr) is posted alongside the invoice's normal journal, via
-- matrix rows with blank GL accounts (see ap_use_tax_gl_account_configs —
-- Accounting authors the values, engineering never fills them in, per the
-- S023 ACCOUNT_MAPPING_VALUES_PENDING convention already used by
-- ap_bank_accounts.gl_account_id / vendors.default_gl_account).
--
-- Tax rate/jurisdiction determination is a CE-10 boundary. Unconfigured =
-- manual rate entry with attestation (who/when/basis), labeled
-- ADAPTER_BOUNDARY_MANUAL_RATE in ap_use_tax_assessments.rate_source.
--
-- Idempotency: the unique index on (tenant_id, invoice_id, assessment_type)
-- is the sole guard against double-assessment on event replay (AC).

CREATE TABLE IF NOT EXISTS "ap_use_tax_gl_account_configs" (
  "tenant_id"                    TEXT NOT NULL,
  "use_tax_expense_gl_account_id" TEXT,
  "use_tax_payable_gl_account_id" TEXT,
  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ap_use_tax_gl_account_configs_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE IF NOT EXISTS "ap_use_tax_rate_configs" (
  "id"           TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "jurisdiction"  TEXT NOT NULL,
  "rate"          DECIMAL(7,6) NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ap_use_tax_rate_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_use_tax_rate_configs_tenant_id_jurisdiction_key" ON "ap_use_tax_rate_configs"("tenant_id", "jurisdiction");
CREATE INDEX IF NOT EXISTS "ap_use_tax_rate_configs_tenant_id_idx" ON "ap_use_tax_rate_configs"("tenant_id");

CREATE TABLE IF NOT EXISTS "ap_use_tax_assessments" (
  "id"                  TEXT NOT NULL,
  "tenant_id"            TEXT NOT NULL,
  "invoice_id"           TEXT NOT NULL,
  "assessment_type"      TEXT NOT NULL DEFAULT 'USE_TAX',
  "jurisdiction"         TEXT NOT NULL,
  "taxable_amount"       DECIMAL(15,2) NOT NULL,
  "rate_source"          TEXT NOT NULL,
  "rate"                 DECIMAL(7,6) NOT NULL,
  "assessed_amount"      DECIMAL(15,2) NOT NULL,
  "period"               TEXT NOT NULL,
  "attested_by"          TEXT,
  "attested_at"          TIMESTAMP(3),
  "attestation_basis"    TEXT,
  "status"               TEXT NOT NULL DEFAULT 'ASSESSED',
  "gl_entry_id"          TEXT,
  "gl_posting_error"     TEXT,
  "voided_at"            TIMESTAMP(3),
  "voided_by"            TEXT,
  "void_reason"          TEXT,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"           TEXT,

  CONSTRAINT "ap_use_tax_assessments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_use_tax_assessments_tenant_invoice_type_key" ON "ap_use_tax_assessments"("tenant_id", "invoice_id", "assessment_type");
CREATE INDEX IF NOT EXISTS "ap_use_tax_assessments_tenant_id_idx" ON "ap_use_tax_assessments"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_use_tax_assessments_tenant_id_period_idx" ON "ap_use_tax_assessments"("tenant_id", "period");
CREATE INDEX IF NOT EXISTS "ap_use_tax_assessments_tenant_id_status_idx" ON "ap_use_tax_assessments"("tenant_id", "status");

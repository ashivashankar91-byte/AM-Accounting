-- CE-09 S050: AR Write-offs & Allowance Model.
--
-- Direct write-off: a distinct-permission, mandatory-reason, threshold-gated
-- closure of a single AR entry (ties out to $0 — the write-off amount
-- always equals the AR entry's full open amount). Reversal restores the AR
-- entry to OPEN (S218-style symmetry).
--
-- Allowance model: aging-band percentages are tenant SAFE_CONFIGURATION
-- (ar_allowance_band_configs). Computation only ever produces a PREVIEW
-- (ar_allowance_previews); posting requires an explicit "approve preview"
-- step first, and the posted amount must equal the approved amount exactly
-- (D-CE09-02) — enforced in the application layer, not by DDL, but the
-- approved_amount column exists precisely so that check has something to
-- compare against without re-computing.

CREATE TABLE IF NOT EXISTS "ar_direct_write_offs" (
  "id"                  TEXT NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "ar_entry_id"         TEXT NOT NULL,
  "amount"              DECIMAL(15,2) NOT NULL,
  "reason"              TEXT NOT NULL,
  "threshold_override"  BOOLEAN NOT NULL DEFAULT false,
  "status"              TEXT NOT NULL DEFAULT 'POSTED',
  "gl_entry_id"         TEXT,
  "gl_posting_error"    TEXT,
  "reversal_of_id"      TEXT,
  "reversed_at"         TIMESTAMP(3),
  "reversed_by"         TEXT,
  "reversal_reason"     TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"          TEXT,

  CONSTRAINT "ar_direct_write_offs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ar_direct_write_offs_tenant_id_idx" ON "ar_direct_write_offs"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_direct_write_offs_tenant_id_ar_entry_id_idx" ON "ar_direct_write_offs"("tenant_id", "ar_entry_id");
CREATE INDEX IF NOT EXISTS "ar_direct_write_offs_tenant_id_status_idx" ON "ar_direct_write_offs"("tenant_id", "status");

-- SAFE_CONFIGURATION: a missing row means no configured threshold — the
-- conservative behavior is left to the application layer (S050 treats a
-- missing threshold config as "no limit configured", never a silent zero).
CREATE TABLE IF NOT EXISTS "ar_write_off_threshold_configs" (
  "tenant_id"        TEXT NOT NULL,
  "threshold_amount" DECIMAL(15,2) NOT NULL,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ar_write_off_threshold_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- "Matrix row" GL account configuration — blank until Accounting configures
-- it (ACCOUNT_MAPPING_VALUES_PENDING pattern).
CREATE TABLE IF NOT EXISTS "ar_write_off_gl_account_configs" (
  "tenant_id"                     TEXT NOT NULL,
  "write_off_expense_gl_account_id" TEXT,
  "ar_control_gl_account_id"        TEXT,
  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ar_write_off_gl_account_configs_pkey" PRIMARY KEY ("tenant_id")
);

CREATE TABLE IF NOT EXISTS "ar_allowance_band_configs" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "band_days_min"  INTEGER NOT NULL,
  "band_days_max"  INTEGER,
  "percent"        DECIMAL(5,2) NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ar_allowance_band_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ar_allowance_band_configs_tenant_id_band_days_min_key" ON "ar_allowance_band_configs"("tenant_id", "band_days_min");
CREATE INDEX IF NOT EXISTS "ar_allowance_band_configs_tenant_id_idx" ON "ar_allowance_band_configs"("tenant_id");

CREATE TABLE IF NOT EXISTS "ar_allowance_previews" (
  "id"                          TEXT NOT NULL,
  "tenant_id"                   TEXT NOT NULL,
  "as_of_date"                  DATE NOT NULL,
  "total_receivables_analyzed"  DECIMAL(15,2) NOT NULL,
  "computed_amount"             DECIMAL(15,2) NOT NULL,
  "band_breakdown"              JSONB NOT NULL,
  "status"                      TEXT NOT NULL DEFAULT 'PREVIEWED',
  "approved_amount"             DECIMAL(15,2),
  "approved_by"                 TEXT,
  "approved_at"                 TIMESTAMP(3),
  "gl_entry_id"                 TEXT,
  "gl_posting_error"            TEXT,
  "posted_by"                   TEXT,
  "posted_at"                   TIMESTAMP(3),
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"                  TEXT,

  CONSTRAINT "ar_allowance_previews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ar_allowance_previews_tenant_id_idx" ON "ar_allowance_previews"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_allowance_previews_tenant_id_status_idx" ON "ar_allowance_previews"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "ar_allowance_gl_account_configs" (
  "tenant_id"                     TEXT NOT NULL,
  "bad_debt_expense_gl_account_id"  TEXT,
  "allowance_contra_gl_account_id"  TEXT,
  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ar_allowance_gl_account_configs_pkey" PRIMARY KEY ("tenant_id")
);

-- Sprint A Migration: EOM Archive Log, FS Versions, Payroll Runs
-- Source PDFs: P1 (Close Out Month), P3 (Financial Statements), P8 (Payroll Complete User Guide)

-- ─────────────────────────────────────────────────────────────
-- A-1: EOM Archive Log (BR-EOM-003, BR-EOM-004)
-- Tracks each archive step run during month-end close (Program 13)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS eom_archive_log (
  id                TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  tenant_id         TEXT        NOT NULL,
  eom_close_id      TEXT        NOT NULL,
  archive_type      VARCHAR(50) NOT NULL,  -- DETAIL_SCHEDULES|SUMMARY_SCHEDULES|GL_TRIAL_BALANCE|MONTHLY_TRANS_REGISTER|GL_DETAIL_SUMMARY|SCHEDULE_REPORTS|FINANCIAL_STATEMENTS
  close_month       INTEGER     NOT NULL,
  close_year        INTEGER     NOT NULL,
  archived_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','FAILED')),
  error_message     TEXT,
  CONSTRAINT pk_eom_archive_log PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_eom_archive_log_tenant ON eom_archive_log(tenant_id, close_year, close_month);

-- A-1: Purge Code + Purge When Zero on schedules table (BR-EOM-008, BR-EOM-005)
-- Purge Code determines how each schedule is purged during month-end
-- Purge When Zero controls Control Name purge eligibility
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'schedules') THEN
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS purge_code       VARCHAR(2);
    ALTER TABLE schedules ADD COLUMN IF NOT EXISTS purge_when_zero  BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- A-1: Annual GL Summary cleared flag on fiscal_periods (BR-EOM-006)
-- Set to true after first-month close of new fiscal year runs (data is cleared)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'fiscal_periods') THEN
    ALTER TABLE fiscal_periods ADD COLUMN IF NOT EXISTS annual_gl_summary_cleared BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- A-2: FS Versions (FS-001 — up to 15 FS version layouts per company)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_versions (
  id             TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  tenant_id      TEXT        NOT NULL,
  version_number INTEGER     NOT NULL CHECK (version_number BETWEEN 1 AND 15),
  name           VARCHAR(100),
  layout_config  JSONB,
  is_active      BOOLEAN     NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_fs_versions PRIMARY KEY (id),
  CONSTRAINT uq_fs_versions_tenant_version UNIQUE (tenant_id, version_number)
);

-- A-2: NCM20 + Fiscal Year Start on gl_system_config (FS-002, FS-005)
ALTER TABLE gl_system_config
  ADD COLUMN IF NOT EXISTS ncm20_enabled            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fiscal_year_start_month  INTEGER NOT NULL DEFAULT 1
    CHECK (fiscal_year_start_month BETWEEN 1 AND 12);

-- ─────────────────────────────────────────────────────────────
-- A-3: Payroll Runs (PAY-001 single-run constraint, PAY-002 immutable check_date)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_runs (
  id                TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  tenant_id         TEXT        NOT NULL,
  check_date        DATE        NOT NULL,  -- immutable after creation (PAY-002)
  pay_period_start  DATE        NOT NULL,
  pay_period_end    DATE        NOT NULL,
  pay_frequency     VARCHAR(20) NOT NULL
                    CHECK (pay_frequency IN ('WEEKLY','BIWEEKLY','SEMI_MONTHLY','MONTHLY')),
  status            VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS'
                    CHECK (status IN ('IN_PROGRESS','VALIDATED','NACHA_GENERATED','FINALIZED','VOIDED')),
  nacha_generated   BOOLEAN     NOT NULL DEFAULT false,  -- PAY-004: finalize gated on this
  locked_by         TEXT,        -- PAY-005: concurrent lock (user ID)
  locked_at         TIMESTAMPTZ,
  created_by        TEXT        NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at      TIMESTAMPTZ,
  finalized_by      TEXT,
  CONSTRAINT pk_payroll_runs PRIMARY KEY (id)
);

-- PAY-001: One active run per tenant (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_runs_one_active
  ON payroll_runs (tenant_id)
  WHERE status = 'IN_PROGRESS';

CREATE INDEX IF NOT EXISTS idx_payroll_runs_tenant ON payroll_runs(tenant_id, created_at DESC);

-- Payroll Wage Bases Breakdown (PAY-008, PAY-010)
CREATE TABLE IF NOT EXISTS payroll_wage_bases (
  id               TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  tenant_id        TEXT          NOT NULL,
  payroll_run_id   TEXT          NOT NULL,
  wage_base_type   VARCHAR(20)   NOT NULL CHECK (wage_base_type IN ('US_FEDERAL','EEFICA','EE_MEDICARE','STATE','FUTA','SUTA')),
  total_wages      NUMERIC(15,2) NOT NULL DEFAULT 0,
  withholding_amt  NUMERIC(15,2) NOT NULL DEFAULT 0,  -- NUMERIC(15,2) — no Float
  gl_account_id    TEXT,
  CONSTRAINT pk_payroll_wage_bases PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_wage_bases_run ON payroll_wage_bases(tenant_id, payroll_run_id);

-- FIX-021: Create fiscal_periods table with Period 13 support
-- @cobol-origin KOMFCAL — fiscal calendar definition, period status tracking
-- @feature Enables 13th month support and centralized period lifecycle management

-- Add CHECK constraints to existing period tables
ALTER TABLE eom_closes
  ADD CONSTRAINT chk_period_month
  CHECK (period_month BETWEEN 1 AND 13);

-- Create fiscal periods master table
CREATE TABLE fiscal_periods (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  fiscal_year INTEGER NOT NULL,
  period_number SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 13),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSED', 'ADJUSTMENT', 'YEAR_END')),
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, fiscal_year, period_number)
);

CREATE INDEX idx_fiscal_periods_tenant_year
  ON fiscal_periods(tenant_id, fiscal_year);

CREATE INDEX idx_fiscal_periods_status
  ON fiscal_periods(tenant_id, status);

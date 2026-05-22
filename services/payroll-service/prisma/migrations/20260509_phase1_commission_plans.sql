-- Phase 1 Feature: Commission Tracking & Reporting
-- Creates commission_plans and commission_records tables
-- @net-new Feature introduced in Phase 1

CREATE TABLE commission_plans (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  plan_type VARCHAR(20) NOT NULL
    CHECK (plan_type IN ('FLAT','PERCENTAGE','TIERED')),
  department VARCHAR(20),
  flat_amount NUMERIC(15,2),
  percentage_rate NUMERIC(5,2),
  tiers JSONB,
  effective_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_commission_plans_tenant ON commission_plans(tenant_id);
CREATE INDEX idx_commission_plans_employee ON commission_plans(tenant_id, employee_id);
CREATE INDEX idx_commission_plans_active ON commission_plans(tenant_id, is_active, effective_date);
CREATE INDEX idx_commission_plans_department ON commission_plans(tenant_id, department);

CREATE TABLE commission_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  deal_id TEXT,
  deal_type VARCHAR(20),
  gross_profit NUMERIC(15,2) NOT NULL,
  commission_amount NUMERIC(15,2) NOT NULL,
  plan_id TEXT REFERENCES commission_plans(id),
  status VARCHAR(20) NOT NULL DEFAULT 'ACCRUED'
    CHECK (status IN ('ACCRUED','PAID','ADJUSTED','CHARGED_BACK')),
  journal_entry_id TEXT,
  period_year INTEGER,
  period_month SMALLINT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

CREATE INDEX idx_commission_records_tenant ON commission_records(tenant_id);
CREATE INDEX idx_commission_records_employee ON commission_records(tenant_id, employee_id);
CREATE INDEX idx_commission_records_period ON commission_records(tenant_id, period_year, period_month);
CREATE INDEX idx_commission_records_status ON commission_records(tenant_id, status);

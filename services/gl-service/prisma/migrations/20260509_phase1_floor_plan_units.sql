-- Phase 1 Feature: Floor Plan Financing Module
-- Creates floor_plan_units table for floored vehicle tracking
-- @net-new Feature introduced in Phase 1

CREATE TABLE floor_plan_units (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  vin VARCHAR(17) NOT NULL,
  lender_id TEXT NOT NULL,
  advance_amount NUMERIC(15,2) NOT NULL,
  current_balance NUMERIC(15,2) NOT NULL,
  interest_rate NUMERIC(6,4) NOT NULL,
  floor_date DATE NOT NULL,
  payoff_date DATE,
  curtailment_schedule JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','PAID_OFF','CURTAILED','DAMAGED')),
  gl_liability_account_id TEXT REFERENCES gl_accounts(id),
  gl_interest_account_id TEXT REFERENCES gl_accounts(id),
  accrued_interest NUMERIC(15,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, vin)
);

CREATE INDEX idx_floor_plan_units_tenant ON floor_plan_units(tenant_id);
CREATE INDEX idx_floor_plan_units_status ON floor_plan_units(tenant_id, status);
CREATE INDEX idx_floor_plan_units_lender ON floor_plan_units(tenant_id, lender_id);
CREATE INDEX idx_floor_plan_units_vin ON floor_plan_units(tenant_id, vin);
CREATE INDEX idx_floor_plan_units_floor_date ON floor_plan_units(tenant_id, floor_date);

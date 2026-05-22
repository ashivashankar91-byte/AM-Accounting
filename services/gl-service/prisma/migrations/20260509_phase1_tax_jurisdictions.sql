-- Phase 1 Feature: Sales Tax Accrual
-- Creates tax_jurisdictions, tax_exemptions, tax_accrual_entries tables
-- @net-new Feature introduced in Phase 1

CREATE TABLE tax_jurisdictions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  jurisdiction_code VARCHAR(50) NOT NULL,
  jurisdiction_name TEXT NOT NULL,
  jurisdiction_level VARCHAR(20) NOT NULL
    CHECK (jurisdiction_level IN ('STATE','COUNTY','CITY','DISTRICT')),
  tax_rate NUMERIC(6,4) NOT NULL,
  gl_payable_account_id TEXT NOT NULL,
  gl_receivable_account_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  effective_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT tax_jurisdictions_fk_payable FOREIGN KEY (gl_payable_account_id) REFERENCES gl_accounts(id),
  CONSTRAINT tax_jurisdictions_fk_receivable FOREIGN KEY (gl_receivable_account_id) REFERENCES gl_accounts(id),
  UNIQUE(tenant_id, jurisdiction_code, effective_date)
);

CREATE INDEX idx_tax_jurisdictions_tenant ON tax_jurisdictions(tenant_id);
CREATE INDEX idx_tax_jurisdictions_code ON tax_jurisdictions(tenant_id, jurisdiction_code);
CREATE INDEX idx_tax_jurisdictions_active ON tax_jurisdictions(tenant_id, is_active);

CREATE TABLE tax_exemptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  jurisdiction_code VARCHAR(50),
  certificate_number TEXT NOT NULL,
  certificate_doc_url TEXT,
  expiration_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, customer_id, jurisdiction_code)
);

CREATE INDEX idx_tax_exemptions_tenant ON tax_exemptions(tenant_id);
CREATE INDEX idx_tax_exemptions_customer ON tax_exemptions(tenant_id, customer_id);
CREATE INDEX idx_tax_exemptions_active ON tax_exemptions(tenant_id, is_active, expiration_date);

CREATE TABLE tax_accrual_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  deal_id TEXT NOT NULL,
  jurisdiction_code VARCHAR(50) NOT NULL,
  taxable_amount NUMERIC(15,2) NOT NULL,
  tax_rate NUMERIC(6,4) NOT NULL,
  tax_amount NUMERIC(15,2) NOT NULL,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  accrual_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tax_accrual_entries_tenant ON tax_accrual_entries(tenant_id);
CREATE INDEX idx_tax_accrual_entries_deal ON tax_accrual_entries(tenant_id, deal_id);
CREATE INDEX idx_tax_accrual_entries_date ON tax_accrual_entries(tenant_id, accrual_date);

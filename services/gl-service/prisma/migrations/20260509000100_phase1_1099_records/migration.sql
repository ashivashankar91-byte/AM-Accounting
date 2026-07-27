-- Phase 1 Feature: 1099 Contractor Reports
-- Creates vendor_1099_records table for 1099-MISC/NEC generation and tracking
-- @net-new Feature introduced in Phase 1

CREATE TABLE vendor_1099_records (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  form_type VARCHAR(10) NOT NULL
    CHECK (form_type IN ('1099-MISC','1099-NEC','1099-X')),
  tin TEXT NOT NULL,
  total_payments NUMERIC(15,2) NOT NULL,
  box_amounts JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','REVIEWED','FILED','CORRECTED','VOID')),
  filed_date DATE,
  adjustment_reason TEXT,
  corrected_from_id TEXT REFERENCES vendor_1099_records(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  updated_by TEXT,
  UNIQUE(tenant_id, vendor_id, tax_year, form_type)
);

CREATE INDEX idx_vendor_1099_records_tenant ON vendor_1099_records(tenant_id);
CREATE INDEX idx_vendor_1099_records_year ON vendor_1099_records(tenant_id, tax_year);
CREATE INDEX idx_vendor_1099_records_status ON vendor_1099_records(tenant_id, status);
CREATE INDEX idx_vendor_1099_records_tin ON vendor_1099_records(tenant_id, tin);

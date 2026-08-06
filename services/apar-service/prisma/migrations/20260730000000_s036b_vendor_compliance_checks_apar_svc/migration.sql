-- AMACC-CH04 S036B: Vendor Compliance Adapters.
--
-- Additive only — no change to `vendors` or any other S036A table. Adds one
-- new table, `vendor_compliance_checks`, tracking per-vendor compliance
-- check records (tax-ID verification, insurance certificate, W-9
-- verification, or a general compliance document — check_type is a label
-- only, no regulatory logic is keyed off it here or anywhere in the
-- application layer). jurisdiction/country are captured as free-text data
-- for future reference; no rule is evaluated against them in this slice.
--
-- status starts at PENDING_REVIEW on create. VERIFIED/REJECTED/EXPIRED are
-- only ever set via an explicit human review action (VendorComplianceService
-- .review) — never automatically. NOT_CONFIGURED / VERIFICATION_UNAVAILABLE
-- are the only outcomes the shipped ManualComplianceAdapter can produce (see
-- compliance-adapter.ts) — it never fabricates a successful verification.

CREATE TABLE IF NOT EXISTS vendor_compliance_checks (
  id                  UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id           TEXT        NOT NULL,
  vendor_id           TEXT        NOT NULL,
  check_type          TEXT        NOT NULL,
  status              TEXT        NOT NULL DEFAULT 'PENDING_REVIEW',
  jurisdiction        TEXT,
  country             TEXT,
  external_reference  TEXT,
  notes               TEXT,
  provider_name       TEXT,
  result_message      TEXT,
  expiration_date     TIMESTAMPTZ,
  last_checked_at     TIMESTAMPTZ,
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         TEXT,
  review_note         TEXT,
  version             INTEGER     NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE vendor_compliance_checks DROP CONSTRAINT IF EXISTS vendor_compliance_checks_check_type_check;
ALTER TABLE vendor_compliance_checks ADD CONSTRAINT vendor_compliance_checks_check_type_check
  CHECK (check_type IN ('TAX_ID_VERIFICATION','INSURANCE_CERTIFICATE','W9_VERIFICATION','GENERAL_COMPLIANCE_DOCUMENT','OTHER'));

ALTER TABLE vendor_compliance_checks DROP CONSTRAINT IF EXISTS vendor_compliance_checks_status_check;
ALTER TABLE vendor_compliance_checks ADD CONSTRAINT vendor_compliance_checks_status_check
  CHECK (status IN ('NOT_CONFIGURED','PENDING_REVIEW','VERIFICATION_UNAVAILABLE','VERIFIED','REJECTED','EXPIRED'));

CREATE INDEX IF NOT EXISTS idx_vendor_compliance_checks_tenant            ON vendor_compliance_checks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendor_compliance_checks_tenant_vendor     ON vendor_compliance_checks (tenant_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_compliance_checks_tenant_status     ON vendor_compliance_checks (tenant_id, status);

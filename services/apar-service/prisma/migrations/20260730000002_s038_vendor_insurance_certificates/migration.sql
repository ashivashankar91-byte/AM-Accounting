-- AMACC-CH04 S038: Vendor Insurance Certificate Management.
--
-- Additive-only. Introduces vendor_insurance_certificates, owned entirely by
-- S038. Reuses the existing S036A `vendors` table for vendor identity/
-- ownership — no second vendor table is created, and vendor_id is a plain
-- value reference (not a DB-level FK) so a certificate row is never lost if
-- vendor-table maintenance ever needs an out-of-band data fix; ownership is
-- enforced in the application layer (VendorInsuranceCertificateService
-- always re-checks the parent Vendor's tenantId before writing) and by RLS.
--
-- Duplicate-active-certificate protection: a partial unique index ensures at
-- most one is_current = true row per (tenant_id, vendor_id, insurance_type).
-- Prisma's declarative @@unique cannot express a partial (WHERE) index, so
-- it is created here directly; schema.prisma documents this via the
-- is_current field comment and the plain @@index on the same columns (kept
-- for query planning — the partial unique index below is what actually
-- enforces uniqueness).

CREATE TABLE IF NOT EXISTS "vendor_insurance_certificates" (
  "id"                          TEXT NOT NULL,
  "tenant_id"                   TEXT NOT NULL,
  "vendor_id"                   TEXT NOT NULL,
  "certificate_number"          TEXT NOT NULL,
  "insurance_provider"          TEXT NOT NULL,
  "insurance_type"              TEXT NOT NULL,
  "effective_date"              TIMESTAMP(3) NOT NULL,
  "expiration_date"             TIMESTAMP(3) NOT NULL,
  "coverage_amount"             DECIMAL(15,2),
  "coverage_description"        TEXT,
  "document_id"                 TEXT,
  "document_file_name"          TEXT,
  "document_mime_type"          TEXT,
  "status"                      TEXT NOT NULL DEFAULT 'ACTIVE',
  "is_current"                  BOOLEAN NOT NULL DEFAULT true,
  "superseded_by_certificate_id" TEXT,
  "previous_certificate_id"     TEXT,
  "revoked_at"                  TIMESTAMP(3),
  "revoked_reason"              TEXT,
  "revoked_by"                  TEXT,
  "notes"                       TEXT,
  "version"                     INTEGER NOT NULL DEFAULT 1,
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"                  TEXT,
  "updated_at"                  TIMESTAMP(3) NOT NULL,
  "updated_by"                  TEXT,

  CONSTRAINT "vendor_insurance_certificates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vendor_insurance_certificates_tenant_id_idx" ON "vendor_insurance_certificates"("tenant_id");
CREATE INDEX IF NOT EXISTS "vendor_insurance_certificates_tenant_id_vendor_id_idx" ON "vendor_insurance_certificates"("tenant_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "vendor_insurance_certificates_tenant_id_status_idx" ON "vendor_insurance_certificates"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "vendor_insurance_certificates_tenant_id_expiration_date_idx" ON "vendor_insurance_certificates"("tenant_id", "expiration_date");
CREATE INDEX IF NOT EXISTS "vendor_insurance_certificates_vendor_id_insurance_type_is_curr" ON "vendor_insurance_certificates"("vendor_id", "insurance_type", "is_current");

-- Duplicate-active-certificate protection (partial unique index — Prisma
-- cannot declare this natively).
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_insurance_certificates_one_current_per_vendor_type"
  ON "vendor_insurance_certificates" ("tenant_id", "vendor_id", "insurance_type")
  WHERE "is_current" = true;

-- ── Row Level Security ───────────────────────────────────────────────────────
-- Same pattern as 20260729010001_add_rls_policies_apar_svc (S036A) — see that
-- migration's header comment for the full rationale (rls-middleware.ts sets
-- app.current_tenant_id before every Prisma query; FORCE ROW LEVEL SECURITY
-- so it applies even to the app's own connection role).
DO $$
DECLARE
  t TEXT := 'vendor_insurance_certificates';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'amacc_rls_bypass') THEN
    CREATE ROLE amacc_rls_bypass NOLOGIN BYPASSRLS;
  END IF;

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_select ON %I', t);
  EXECUTE format(
    'CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (tenant_id = current_setting(''app.current_tenant_id'', true))',
    t
  );

  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_insert ON %I', t);
  EXECUTE format(
    'CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))',
    t
  );

  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_update ON %I', t);
  EXECUTE format(
    'CREATE POLICY tenant_isolation_update ON %I FOR UPDATE USING (tenant_id = current_setting(''app.current_tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true))',
    t
  );

  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_delete ON %I', t);
  EXECUTE format(
    'CREATE POLICY tenant_isolation_delete ON %I FOR DELETE USING (tenant_id = current_setting(''app.current_tenant_id'', true))',
    t
  );

  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO amacc_rls_bypass', t);
END $$;

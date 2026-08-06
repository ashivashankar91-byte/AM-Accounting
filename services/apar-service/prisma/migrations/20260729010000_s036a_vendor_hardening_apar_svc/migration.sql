-- AMACC-CH04 S036A: Internal Vendor Master Hardening and UI Convergence.
--
-- PO decision (2026-07-29): harden the existing `vendors` table (S3-07) in
-- place — no parallel `ap_vendors` table, no second vendor service. This
-- migration is additive-only: every new column has a safe default and, for
-- existing rows, a deterministic backfill. No existing column is dropped,
-- renamed or transformed (BR-AP-001 logical-delete-only continues to apply;
-- taxId/banking plaintext values are left exactly as they are — see the
-- S036A blockers report for why: no approved encrypted-field mechanism
-- exists repository-wide, so no new plaintext tax-ID writes are introduced
-- and none of the existing values are touched by this migration either).

-- ── Vendor type ──────────────────────────────────────────────────────────────
-- Approved values (PO decision): SUPPLIER | SERVICE_PROVIDER | GOVERNMENT | OTHER.
-- Existing rows have no prior classification — backfilled to OTHER, the
-- least-assuming value, not a guess at any real vendor's type.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_type TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_vendor_type_check;
ALTER TABLE vendors ADD CONSTRAINT vendors_vendor_type_check
  CHECK (vendor_type IN ('SUPPLIER','SERVICE_PROVIDER','GOVERNMENT','OTHER'));

-- ── Lifecycle: ACTIVE | INACTIVE | DELETED ──────────────────────────────────
-- `status` is the new source of truth. `is_active` (pre-existing column) is
-- kept in sync by VendorService on every write so pre-S036A consumers that
-- filter on is_active directly (1099 vendor list, payment-reconciliation
-- vendor join in routes.ts) keep working unchanged.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
UPDATE vendors SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END;
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_status_check;
ALTER TABLE vendors ADD CONSTRAINT vendors_status_check
  CHECK (status IN ('ACTIVE','INACTIVE','DELETED'));

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS inactive_reason TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS inactivated_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS inactivated_by TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS reactivated_by TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- ── Duplicate-detection normalized comparison columns ───────────────────────
-- Computed here for existing rows; VendorService computes them on every
-- future create/update so they never drift from the source fields.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS normalized_vendor_number TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS normalized_vendor_name TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS normalized_email TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS normalized_phone TEXT;

UPDATE vendors SET
  normalized_vendor_number = upper(trim(vendor_number)),
  normalized_vendor_name   = lower(trim(vendor_name)),
  normalized_email         = CASE WHEN email IS NOT NULL AND trim(email) <> '' THEN lower(trim(email)) ELSE NULL END,
  normalized_phone         = CASE WHEN phone IS NOT NULL AND trim(regexp_replace(phone, '\D', '', 'g')) <> '' THEN regexp_replace(phone, '\D', '', 'g') ELSE NULL END
WHERE normalized_vendor_number IS NULL;

ALTER TABLE vendors ALTER COLUMN normalized_vendor_number SET NOT NULL;
ALTER TABLE vendors ALTER COLUMN normalized_vendor_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vendors_tenant_status            ON vendors (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_vendors_tenant_norm_number       ON vendors (tenant_id, normalized_vendor_number);
CREATE INDEX IF NOT EXISTS idx_vendors_tenant_norm_name         ON vendors (tenant_id, normalized_vendor_name);
CREATE INDEX IF NOT EXISTS idx_vendors_tenant_norm_email        ON vendors (tenant_id, normalized_email);
CREATE INDEX IF NOT EXISTS idx_vendors_tenant_norm_phone        ON vendors (tenant_id, normalized_phone);

-- ── Per-tenant atomic vendor-number counter ─────────────────────────────────
-- Replaces the pre-existing `SELECT count(*)+1` generation in routes.ts,
-- which raced under concurrent creates (two requests could read the same
-- count and both attempt the same vendor_number, colliding on the
-- tenant_id+vendor_number unique constraint below). Seeded per-tenant from
-- the current max numeric vendor_number so newly-generated numbers never
-- collide with existing data.
CREATE TABLE IF NOT EXISTS ap_vendor_number_counters (
  tenant_id   TEXT    NOT NULL PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

INSERT INTO ap_vendor_number_counters (tenant_id, next_number)
SELECT tenant_id, COALESCE(MAX(vendor_number::INTEGER), 0) + 1
FROM vendors
WHERE vendor_number ~ '^[0-9]+$'
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

-- ── Duplicate-vendor acknowledgement ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ap_vendor_duplicate_acknowledgements (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       TEXT        NOT NULL,
  vendor_id       TEXT        NOT NULL,
  matched_signals JSONB       NOT NULL,
  reason          TEXT        NOT NULL,
  actor           TEXT        NOT NULL,
  correlation_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ap_vendor_dup_ack_tenant_vendor
  ON ap_vendor_duplicate_acknowledgements (tenant_id, vendor_id);

-- ── AuditPort outbox ──────────────────────────────────────────────────────────
-- apar-service had no audit mechanism at all before S036A. Same shape as
-- tenant-service/auth-service/coa-service's audit_outbox (see
-- packages/shared-kernel/src/audit/audit-outbox-drainer.ts).
CREATE TABLE IF NOT EXISTS audit_outbox (
  id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    TEXT        NOT NULL,
  doc_type     TEXT        NOT NULL,
  doc_id       TEXT        NOT NULL,
  action       TEXT        NOT NULL,
  before       JSONB,
  after        JSONB,
  actor        TEXT        NOT NULL,
  published_at TIMESTAMPTZ,
  retry_count  INTEGER     NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_outbox_published_retry ON audit_outbox (published_at, retry_count);

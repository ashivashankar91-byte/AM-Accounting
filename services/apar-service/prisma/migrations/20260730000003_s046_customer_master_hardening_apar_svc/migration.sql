-- S046: Customer AR Master and Credit Profile — hardening and UI
-- convergence for the existing `customers` table (S5-01).
--
-- Scope decision (mirrors the S036A vendor-master precedent): harden the
-- existing `customers` table in place — no parallel customer table, no
-- second customer service. This migration is additive-only: every new
-- column has a safe default and, for existing rows, a deterministic
-- backfill. No existing column is dropped, renamed or transformed.
--
-- S046's story title is "Customer AR Master, Credit & Statements" but this
-- slice implements ONLY the master-record + credit-profile portion.
-- Statements, invoicing, receipts, cash application, write-offs and NSF
-- processing are explicitly OUT of scope (S047-S051) and are not touched by
-- this migration or any code in this commit.

-- ── Duplicate-detection normalized comparison columns ───────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_customer_number TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_customer_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS normalized_phone TEXT;

UPDATE customers SET
  normalized_customer_number = upper(trim(customer_number)),
  normalized_customer_name   = lower(trim(customer_name)),
  normalized_email           = CASE WHEN email IS NOT NULL AND trim(email) <> '' THEN lower(trim(email)) ELSE NULL END,
  normalized_phone           = CASE WHEN phone IS NOT NULL AND trim(regexp_replace(phone, '\D', '', 'g')) <> '' THEN regexp_replace(phone, '\D', '', 'g') ELSE NULL END
WHERE normalized_customer_number IS NULL;

ALTER TABLE customers ALTER COLUMN normalized_customer_number SET NOT NULL;
ALTER TABLE customers ALTER COLUMN normalized_customer_name SET NOT NULL;

-- ── Lifecycle: ACTIVE | INACTIVE | DELETED ──────────────────────────────────
-- `status` is the new source of truth. `is_active` (pre-existing column) is
-- kept in sync by CustomerService on every write so pre-S046 consumers that
-- filter on is_active directly keep working unchanged.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
UPDATE customers SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'INACTIVE' END;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_status_check
  CHECK (status IN ('ACTIVE','INACTIVE','DELETED'));

ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS inactive_reason TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS inactivated_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS inactivated_by TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS reactivated_by TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_by TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS delete_reason TEXT;

-- ── Credit profile ───────────────────────────────────────────────────────────
-- credit_limit and credit_terms already existed (S5-01). Adding: hold
-- status/reason/audit timestamps, and an effective-date marker for the
-- current credit profile. No automatic credit scoring or bureau integration
-- is introduced — PO-DEC scope explicitly excludes it for S046.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold_reason TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold_set_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold_set_by TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold_cleared_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_hold_cleared_by TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_profile_effective_date TIMESTAMPTZ;
UPDATE customers SET credit_profile_effective_date = created_at WHERE credit_profile_effective_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_tenant_status          ON customers (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_norm_number     ON customers (tenant_id, normalized_customer_number);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_norm_name       ON customers (tenant_id, normalized_customer_name);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_norm_email      ON customers (tenant_id, normalized_email);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_norm_phone      ON customers (tenant_id, normalized_phone);

-- ── Per-tenant atomic customer-number counter ───────────────────────────────
-- Replaces the pre-existing `SELECT count(*)+1` generation in routes.ts,
-- which raced under concurrent creates. Seeded per-tenant from the current
-- max numeric customer_number so newly-generated numbers never collide with
-- existing data.
CREATE TABLE IF NOT EXISTS ar_customer_number_counters (
  tenant_id   TEXT    NOT NULL PRIMARY KEY,
  next_number INTEGER NOT NULL DEFAULT 1
);

INSERT INTO ar_customer_number_counters (tenant_id, next_number)
SELECT tenant_id, COALESCE(MAX(customer_number::INTEGER), 0) + 1
FROM customers
WHERE customer_number ~ '^[0-9]+$'
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

-- ── Duplicate-customer acknowledgement ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ar_customer_duplicate_acknowledgements (
  id              UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       TEXT        NOT NULL,
  customer_id     TEXT        NOT NULL,
  matched_signals JSONB       NOT NULL,
  reason          TEXT        NOT NULL,
  actor           TEXT        NOT NULL,
  correlation_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ar_customer_dup_ack_tenant_customer
  ON ar_customer_duplicate_acknowledgements (tenant_id, customer_id);

-- audit_outbox already exists (created by the S036A vendor-master
-- migration, 20260729010000) — CustomerService reuses the same table, no
-- new audit mechanism needed here.

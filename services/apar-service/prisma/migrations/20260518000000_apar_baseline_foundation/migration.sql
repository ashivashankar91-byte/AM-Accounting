-- AMACC-CH04 S036A prerequisite fix: apar-service's prisma/migrations
-- directory had no migration_lock.toml and its three existing migrations
-- were flat .sql files (not the `<timestamp>_<name>/migration.sql` folder
-- form `prisma migrate deploy` requires), and none of them created
-- ar_entries, ap_entries, outbox_events, vendors or ap_bank_accounts —
-- those tables were evidently applied out-of-band (e.g. `prisma db push`)
-- and never captured as a migration. A fresh database built from
-- "committed migrations only" would therefore fail immediately (sprint2's
-- `ALTER TABLE ap_entries` and sprint6's `ALTER TABLE ar_entries` both
-- assume the table already exists; the S036A vendor-hardening migration
-- below needs `vendors` to already exist too). This migration captures the
-- pre-S036A foundation schema for real, as it already exists in this
-- codebase's schema.prisma, so `prisma migrate deploy` can build
-- apar-service from scratch. No column here changes existing behavior —
-- this is a like-for-like capture, not a redesign.
--
-- Idempotent (`IF NOT EXISTS`) matching this service's existing migration
-- convention, so it is a no-op against any environment where these tables
-- were already created out-of-band.

CREATE TABLE IF NOT EXISTS ar_entries (
  id                       UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                TEXT          NOT NULL,
  dealer_ref               TEXT          NOT NULL,
  type                     TEXT          NOT NULL,
  amount                   NUMERIC(15,2) NOT NULL,
  due_date                 TIMESTAMPTZ   NOT NULL,
  status                   TEXT          NOT NULL DEFAULT 'OPEN',
  oem_source               TEXT,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  journal_source           VARCHAR(2),
  source_document_type     VARCHAR(20),
  source_document_number   VARCHAR(20),
  cashier_user_id          TEXT,
  cashier_date_time        TIMESTAMPTZ,
  customer_pay_portion     NUMERIC(15,2),
  check_name               VARCHAR(50),
  remarks                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ar_entries_tenant                ON ar_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ar_entries_tenant_status         ON ar_entries (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_ar_entries_tenant_journal_source ON ar_entries (tenant_id, journal_source);

CREATE TABLE IF NOT EXISTS ap_entries (
  id            UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     TEXT          NOT NULL,
  vendor_name   TEXT          NOT NULL,
  invoice_ref   TEXT          NOT NULL,
  amount        NUMERIC(15,2) NOT NULL,
  due_date      TIMESTAMPTZ   NOT NULL,
  status        TEXT          NOT NULL DEFAULT 'OPEN',
  gl_account_id TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ap_entries_tenant        ON ap_entries (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ap_entries_tenant_status ON ap_entries (tenant_id, status);

CREATE TABLE IF NOT EXISTS outbox_events (
  id             UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type     TEXT          NOT NULL,
  tenant_id      TEXT          NOT NULL,
  payload        JSONB         NOT NULL,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  published_at   TIMESTAMPTZ,
  retry_count    INTEGER       NOT NULL DEFAULT 0,
  last_error     TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_published_retry ON outbox_events (published_at, retry_count);
CREATE INDEX IF NOT EXISTS idx_outbox_events_created         ON outbox_events (created_at);

-- S3-07: Vendor master, pre-S036A shape. Hardened by the S036A migration
-- that follows sprint5/sprint6/sprint2 below.
CREATE TABLE IF NOT EXISTS vendors (
  id                      UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id               TEXT          NOT NULL,
  vendor_number           VARCHAR(20)   NOT NULL,
  vendor_name             TEXT          NOT NULL,
  dba                     TEXT,
  contact_name            TEXT,
  phone                   TEXT,
  fax                     TEXT,
  email                   TEXT,
  address1                TEXT,
  address2                TEXT,
  city                    TEXT,
  state                   VARCHAR(2),
  zip                     VARCHAR(10),
  tax_id                  TEXT,
  is_1099_misc            BOOLEAN       NOT NULL DEFAULT FALSE,
  is_1099_nec             BOOLEAN       NOT NULL DEFAULT FALSE,
  income_1099_type        TEXT,
  w9_on_file              BOOLEAN       NOT NULL DEFAULT FALSE,
  w9_received_date        TIMESTAMPTZ,
  payment_terms           TEXT          NOT NULL DEFAULT 'Net30',
  default_gl_account      TEXT,
  payment_method          TEXT          NOT NULL DEFAULT 'Check',
  discount_percent        NUMERIC(5,2)  NOT NULL DEFAULT 0,
  discount_days           INTEGER       NOT NULL DEFAULT 0,
  bank_name               TEXT,
  bank_routing_number     VARCHAR(9),
  bank_account_number     TEXT,
  bank_account_type       TEXT,
  separate_check          BOOLEAN       NOT NULL DEFAULT FALSE,
  hold_payments           BOOLEAN       NOT NULL DEFAULT FALSE,
  default_expense_account TEXT,
  notes                   TEXT,
  is_active               BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, vendor_number)
);

CREATE INDEX IF NOT EXISTS idx_vendors_tenant        ON vendors (tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendors_tenant_active ON vendors (tenant_id, is_active);

CREATE TABLE IF NOT EXISTS ap_bank_accounts (
  id                UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         TEXT          NOT NULL,
  bank_name         TEXT          NOT NULL,
  account_number    TEXT          NOT NULL,
  routing_number    TEXT          NOT NULL,
  next_check_number INTEGER       NOT NULL DEFAULT 1001,
  is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, account_number)
);

CREATE INDEX IF NOT EXISTS idx_ap_bank_accounts_tenant ON ap_bank_accounts (tenant_id);

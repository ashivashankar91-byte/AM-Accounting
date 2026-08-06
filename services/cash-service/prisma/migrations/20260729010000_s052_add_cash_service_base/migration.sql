-- S052 — POS Cash Receipts, Cashier Drawers, Blind Close and Over/Short.
-- Base schema for the new cash-service. Additive only. All money
-- DECIMAL(15,2) per CLAUDE.md's non-negotiable money rule. Every AMACC
-- service shares one physical Postgres database/schema and one
-- _prisma_migrations tracking table (see coa-service's
-- 20260727000001_exclude_outbox_tables_from_rls_coa_svc header comment) —
-- this migration folder name and every table name below is unique across
-- the whole repository (checked against every services/*/prisma/schema.prisma).

-- ── audit_outbox (shared) ────────────────────────────────────────────────────
-- AuditPort stub outbox (S007 dependency). Every audit-writing service models
-- this identically and creates it with CREATE TABLE IF NOT EXISTS — see
-- tenant-service/coa-service/gl-service's own copies of this exact DDL.
CREATE TABLE IF NOT EXISTS "audit_outbox" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "doc_type"     TEXT NOT NULL,
  "doc_id"       TEXT NOT NULL,
  "action"       TEXT NOT NULL,
  "before"       JSONB,
  "after"        JSONB,
  "actor"        TEXT NOT NULL,
  "published_at" TIMESTAMP(3),
  "retry_count"  INTEGER NOT NULL DEFAULT 0,
  "last_error"   TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "audit_outbox_published_at_retry_count_idx"
  ON "audit_outbox" ("published_at", "retry_count");

-- ── cash_outbox_events ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_outbox_events" (
  "id"           TEXT PRIMARY KEY,
  "tenant_id"    TEXT NOT NULL,
  "event_type"   TEXT NOT NULL,
  "aggregate_id" TEXT NOT NULL,
  "payload"      JSONB NOT NULL,
  "published_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "cash_outbox_events_published_at_idx" ON "cash_outbox_events" ("published_at");

-- ── cash_receipt_sequence ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_receipt_sequence" (
  "id"            TEXT PRIMARY KEY,
  "tenant_id"     TEXT NOT NULL,
  "store_id"      TEXT NOT NULL,
  "business_date" DATE NOT NULL,
  "next_seq"      INTEGER NOT NULL DEFAULT 1,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_receipt_sequence_next_chk" CHECK ("next_seq" >= 1),
  CONSTRAINT "cash_receipt_sequence_uq" UNIQUE ("tenant_id", "store_id", "business_date")
);

-- ── cash_drawer ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_drawer" (
  "id"              TEXT PRIMARY KEY,
  "tenant_id"       TEXT NOT NULL,
  "entity_id"       TEXT NOT NULL,
  "store_id"        TEXT NOT NULL,
  "store_code"      VARCHAR(20) NOT NULL,
  "terminal_code"   VARCHAR(20) NOT NULL,
  "cashier_id"      TEXT NOT NULL,
  "cashier_name"    TEXT,
  "business_date"   DATE NOT NULL,
  "currency"        VARCHAR(3) NOT NULL DEFAULT 'USD',
  "opening_float"   DECIMAL(15,2) NOT NULL,
  "float_locked"    BOOLEAN NOT NULL DEFAULT false,
  "retained_float"  DECIMAL(15,2),
  "status"          TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | BLIND_COUNT_SUBMITTED | VARIANCE_REVIEW_REQUIRED | RECONCILED
  "opened_by"       TEXT NOT NULL,
  "opened_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reconciled_by"   TEXT,
  "reconciled_at"   TIMESTAMP(3),
  "version"         INTEGER NOT NULL DEFAULT 1,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_drawer_status_chk" CHECK ("status" IN ('OPEN', 'BLIND_COUNT_SUBMITTED', 'VARIANCE_REVIEW_REQUIRED', 'RECONCILED')),
  CONSTRAINT "cash_drawer_opening_float_chk" CHECK ("opening_float" >= 0)
);
CREATE INDEX IF NOT EXISTS "cash_drawer_cashier_status_idx" ON "cash_drawer" ("tenant_id", "cashier_id", "status");
CREATE INDEX IF NOT EXISTS "cash_drawer_terminal_status_idx" ON "cash_drawer" ("tenant_id", "terminal_code", "status");
CREATE INDEX IF NOT EXISTS "cash_drawer_store_date_idx" ON "cash_drawer" ("tenant_id", "store_id", "business_date");

-- ── cash_receipt ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_receipt" (
  "id"                    TEXT PRIMARY KEY,
  "tenant_id"             TEXT NOT NULL,
  "entity_id"             TEXT NOT NULL,
  "store_id"              TEXT NOT NULL,
  "drawer_id"             TEXT NOT NULL,
  "receipt_number"        TEXT NOT NULL,
  "status"                TEXT NOT NULL DEFAULT 'ISSUED', -- ISSUED | VOIDED
  "source_doc_type"       TEXT NOT NULL,
  "source_doc_id"         TEXT NOT NULL,
  "source_display_number" TEXT,
  "payer_reference"       TEXT,
  "amount_due"            DECIMAL(15,2),
  "total_amount"          DECIMAL(15,2) NOT NULL,
  "currency"              VARCHAR(3) NOT NULL DEFAULT 'USD',
  "cashier_id"            TEXT NOT NULL,
  "idempotency_key"       TEXT NOT NULL,
  "issued_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_at"             TIMESTAMP(3),
  "void_reason"           TEXT,
  "voided_by"             TEXT,
  "version"               INTEGER NOT NULL DEFAULT 1,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_receipt_drawer_fk" FOREIGN KEY ("drawer_id") REFERENCES "cash_drawer"("id"),
  CONSTRAINT "cash_receipt_status_chk" CHECK ("status" IN ('ISSUED', 'VOIDED')),
  CONSTRAINT "cash_receipt_total_amount_chk" CHECK ("total_amount" > 0),
  CONSTRAINT "cash_receipt_tenant_idempotency_key" UNIQUE ("tenant_id", "idempotency_key"),
  CONSTRAINT "cash_receipt_entity_number_key" UNIQUE ("tenant_id", "entity_id", "receipt_number")
);
CREATE INDEX IF NOT EXISTS "cash_receipt_drawer_idx" ON "cash_receipt" ("tenant_id", "drawer_id");
CREATE INDEX IF NOT EXISTS "cash_receipt_source_idx" ON "cash_receipt" ("tenant_id", "source_doc_type", "source_doc_id");
CREATE INDEX IF NOT EXISTS "cash_receipt_status_idx" ON "cash_receipt" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "cash_receipt_store_issued_idx" ON "cash_receipt" ("tenant_id", "store_id", "issued_at");

-- ── cash_receipt_tender ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_receipt_tender" (
  "id"             TEXT PRIMARY KEY,
  "tenant_id"      TEXT NOT NULL,
  "receipt_id"     TEXT NOT NULL,
  "tender_type"    TEXT NOT NULL, -- CASH | CHECK
  "amount"         DECIMAL(15,2) NOT NULL,
  "cash_tendered"  DECIMAL(15,2),
  "change_given"   DECIMAL(15,2),
  "check_number"   TEXT,
  "check_payer"    TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_receipt_tender_receipt_fk" FOREIGN KEY ("receipt_id") REFERENCES "cash_receipt"("id"),
  CONSTRAINT "cash_receipt_tender_type_chk" CHECK ("tender_type" IN ('CASH', 'CHECK')),
  CONSTRAINT "cash_receipt_tender_amount_chk" CHECK ("amount" > 0)
);
CREATE INDEX IF NOT EXISTS "cash_receipt_tender_receipt_idx" ON "cash_receipt_tender" ("tenant_id", "receipt_id");

-- ── cash_drawer_movement (append-only; see constraints migration) ───────────
CREATE TABLE IF NOT EXISTS "cash_drawer_movement" (
  "id"             TEXT PRIMARY KEY,
  "tenant_id"      TEXT NOT NULL,
  "drawer_id"      TEXT NOT NULL,
  "movement_type"  TEXT NOT NULL, -- OPEN_FLOAT | CASH_RECEIPT | CASH_VOID_REVERSAL | CHECK_RECEIPT | CHECK_VOID_REVERSAL
  "amount"         DECIMAL(15,2) NOT NULL,
  "tender_type"    TEXT, -- CASH | CHECK | null for OPEN_FLOAT
  "receipt_id"     TEXT,
  "check_number"   TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_drawer_movement_drawer_fk" FOREIGN KEY ("drawer_id") REFERENCES "cash_drawer"("id"),
  CONSTRAINT "cash_drawer_movement_type_chk" CHECK (
    "movement_type" IN ('OPEN_FLOAT', 'CASH_RECEIPT', 'CASH_VOID_REVERSAL', 'CHECK_RECEIPT', 'CHECK_VOID_REVERSAL')
  )
);
CREATE INDEX IF NOT EXISTS "cash_drawer_movement_drawer_type_idx" ON "cash_drawer_movement" ("tenant_id", "drawer_id", "movement_type");
CREATE INDEX IF NOT EXISTS "cash_drawer_movement_receipt_idx" ON "cash_drawer_movement" ("tenant_id", "receipt_id");

-- ── cash_blind_count ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_blind_count" (
  "id"             TEXT PRIMARY KEY,
  "tenant_id"      TEXT NOT NULL,
  "drawer_id"      TEXT NOT NULL,
  "counted_cash"   DECIMAL(15,2) NOT NULL,
  "check_count"    INTEGER NOT NULL,
  "check_total"    DECIMAL(15,2) NOT NULL,
  "retained_float" DECIMAL(15,2) NOT NULL,
  "cashier_note"   TEXT,
  "submitted_by"   TEXT NOT NULL,
  "submitted_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"        INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "cash_blind_count_drawer_fk" FOREIGN KEY ("drawer_id") REFERENCES "cash_drawer"("id"),
  CONSTRAINT "cash_blind_count_drawer_uq" UNIQUE ("drawer_id"),
  CONSTRAINT "cash_blind_count_counted_cash_chk" CHECK ("counted_cash" >= 0),
  CONSTRAINT "cash_blind_count_check_count_chk" CHECK ("check_count" >= 0),
  CONSTRAINT "cash_blind_count_retained_float_chk" CHECK ("retained_float" >= 0)
);

-- ── cash_blind_count_line ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_blind_count_line" (
  "id"              TEXT PRIMARY KEY,
  "tenant_id"       TEXT NOT NULL,
  "blind_count_id"  TEXT NOT NULL,
  "check_number"    TEXT,
  "amount"          DECIMAL(15,2) NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_blind_count_line_parent_fk" FOREIGN KEY ("blind_count_id") REFERENCES "cash_blind_count"("id")
);
CREATE INDEX IF NOT EXISTS "cash_blind_count_line_parent_idx" ON "cash_blind_count_line" ("tenant_id", "blind_count_id");

-- ── cash_drawer_variance ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_drawer_variance" (
  "id"                     TEXT PRIMARY KEY,
  "tenant_id"              TEXT NOT NULL,
  "drawer_id"              TEXT NOT NULL,
  "expected_cash"          DECIMAL(15,2) NOT NULL,
  "counted_cash"           DECIMAL(15,2) NOT NULL,
  "cash_variance"          DECIMAL(15,2) NOT NULL,
  "tolerance_applied"      DECIMAL(15,2) NOT NULL,
  "classification"         TEXT NOT NULL, -- EXACT | WITHIN_TOLERANCE | OUTSIDE_TOLERANCE | NON_CASH_EXCEPTION
  "expected_check_count"   INTEGER NOT NULL,
  "expected_check_total"   DECIMAL(15,2) NOT NULL,
  "counted_check_count"    INTEGER NOT NULL,
  "counted_check_total"    DECIMAL(15,2) NOT NULL,
  "check_discrepancy"      BOOLEAN NOT NULL,
  "requires_approval"      BOOLEAN NOT NULL,
  "deposit_eligible_cash"  DECIMAL(15,2) NOT NULL,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_drawer_variance_drawer_fk" FOREIGN KEY ("drawer_id") REFERENCES "cash_drawer"("id"),
  CONSTRAINT "cash_drawer_variance_drawer_uq" UNIQUE ("drawer_id"),
  CONSTRAINT "cash_drawer_variance_classification_chk" CHECK (
    "classification" IN ('EXACT', 'WITHIN_TOLERANCE', 'OUTSIDE_TOLERANCE', 'NON_CASH_EXCEPTION')
  )
);

-- ── cash_variance_approval ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_variance_approval" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "drawer_id"         TEXT NOT NULL,
  "variance_id"       TEXT NOT NULL,
  "approved_by"       TEXT NOT NULL,
  "approval_reason"   TEXT NOT NULL,
  "approved_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_variance_approval_drawer_fk" FOREIGN KEY ("drawer_id") REFERENCES "cash_drawer"("id"),
  CONSTRAINT "cash_variance_approval_drawer_uq" UNIQUE ("drawer_id")
);

-- ── cash_variance_tolerance_config ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cash_variance_tolerance_config" (
  "id"                TEXT PRIMARY KEY,
  "tenant_id"         TEXT NOT NULL,
  "scope"             TEXT NOT NULL, -- TENANT | ENTITY | STORE
  "scope_id"          TEXT,          -- null for TENANT scope
  "tolerance_amount"  DECIMAL(15,2) NOT NULL,
  "updated_by"        TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cash_variance_tolerance_scope_chk" CHECK ("scope" IN ('TENANT', 'ENTITY', 'STORE')),
  CONSTRAINT "cash_variance_tolerance_amount_chk" CHECK ("tolerance_amount" >= 0)
);
CREATE INDEX IF NOT EXISTS "cash_variance_tolerance_lookup_idx" ON "cash_variance_tolerance_config" ("tenant_id", "scope", "scope_id");
-- COALESCE trick (nullable scope_id) — same technique as auth-service's
-- authz_role_assignment_unique — so at most one row exists per resolved scope.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_variance_tolerance_scope_uq"
  ON "cash_variance_tolerance_config" ("tenant_id", "scope", COALESCE("scope_id", ''));

SELECT '---APPLIED---' AS status;

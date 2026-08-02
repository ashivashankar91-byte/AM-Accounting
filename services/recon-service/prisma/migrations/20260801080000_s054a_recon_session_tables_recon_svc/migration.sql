-- S054A — Manual Bank Reconciliation Workbench (genuine rebuild). Adds a
-- session-per-bank-account+statement-period model alongside the existing
-- bank_recons/bank_transactions prototype (left untouched — additive only,
-- never editing an existing migration). recon_session/recon_statement_line/
-- recon_book_item support: manual entry AND imported statement lines,
-- matching/clearing against book-side item types synced from cash-service
-- (deposits/sweeps/settlement-fees) or apar-service (payments) via HTTP, or
-- entered manually (e.g. NSF), a conservation check gating completion, and
-- no deletion of cleared lines ever (only unmatch before completion).

-- ── audit_outbox (shared) ────────────────────────────────────────────────────
-- AuditPort stub outbox (S007 dependency). Every audit-writing service models
-- this identically and creates it with CREATE TABLE IF NOT EXISTS — see
-- cash-service/tenant-service/coa-service/gl-service's own copies of this
-- exact DDL.
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

-- ── recon_session ────────────────────────────────────────────────────────────
CREATE TABLE "recon_session" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "bank_account_code" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "statement_beginning_balance" DECIMAL(15,2) NOT NULL,
    "statement_ending_balance" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recon_session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recon_session_tenant_id_idempotency_key_key" ON "recon_session"("tenant_id", "idempotency_key");
CREATE INDEX "recon_session_tenant_id_bank_account_code_idx" ON "recon_session"("tenant_id", "bank_account_code");

-- ── recon_statement_line ─────────────────────────────────────────────────────
CREATE TABLE "recon_statement_line" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "line_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "source" TEXT NOT NULL,
    "external_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "cleared_book_item_id" TEXT,
    "cleared_by" TEXT,
    "cleared_at" TIMESTAMP(3),
    "match_rule_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recon_statement_line_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recon_statement_line_session_id_status_idx" ON "recon_statement_line"("session_id", "status");
CREATE INDEX "recon_statement_line_tenant_id_idx" ON "recon_statement_line"("tenant_id");
ALTER TABLE "recon_statement_line" ADD CONSTRAINT "recon_statement_line_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "recon_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── recon_book_item ──────────────────────────────────────────────────────────
CREATE TABLE "recon_book_item" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "source_service" TEXT NOT NULL,
    "source_id" TEXT,
    "item_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OUTSTANDING',
    "cleared_statement_line_id" TEXT,
    "cleared_by" TEXT,
    "cleared_at" TIMESTAMP(3),
    "match_rule_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recon_book_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recon_book_item_session_id_source_service_source_id_key" ON "recon_book_item"("session_id", "source_service", "source_id");
CREATE INDEX "recon_book_item_session_id_status_idx" ON "recon_book_item"("session_id", "status");
CREATE INDEX "recon_book_item_tenant_id_idx" ON "recon_book_item"("tenant_id");
ALTER TABLE "recon_book_item" ADD CONSTRAINT "recon_book_item_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "recon_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

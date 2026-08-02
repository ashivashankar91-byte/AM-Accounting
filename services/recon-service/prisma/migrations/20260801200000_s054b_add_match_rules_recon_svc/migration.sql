-- S054B — Rule-Based Bank Auto-Match. Adds tenant-configurable match
-- rules (amount+date window, reference-contains, check-number,
-- batch-total) and a suggestion worklist for SUGGESTED-tier / ambiguous
-- EXACT-tier candidates. Auto-clearing itself reuses the existing
-- recon_statement_line.match_rule_id / recon_book_item.match_rule_id
-- columns added in the S054A migration (already present — no schema
-- change needed there).

CREATE TABLE "recon_match_rule" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_id" TEXT,
    "bank_account_code" TEXT,
    "rule_type" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recon_match_rule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "recon_match_rule_tenant_id_active_idx" ON "recon_match_rule"("tenant_id", "active");

CREATE TABLE "recon_match_suggestion" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "statement_line_id" TEXT NOT NULL,
    "book_item_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "recon_match_suggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recon_match_suggestion_session_id_statement_line_id_book_i_key" ON "recon_match_suggestion"("session_id", "statement_line_id", "book_item_id", "rule_id");
CREATE INDEX "recon_match_suggestion_session_id_status_idx" ON "recon_match_suggestion"("session_id", "status");
ALTER TABLE "recon_match_suggestion" ADD CONSTRAINT "recon_match_suggestion_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "recon_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

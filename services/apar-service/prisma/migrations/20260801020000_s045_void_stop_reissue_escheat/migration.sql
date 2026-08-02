-- CE-09 S045: Void/Stop/Reissue & Check Escheat.
--
-- Void-before-cleared reverses the payment's GL entry and restores the AP
-- open item (existing ManualPaymentService.void() flow, now guarded by
-- clearedAt — see below). Void-after-cleared is REFUSED (D-CE09-01) — the
-- correction path is a deposit/bank-side adjustment, never unwinding a
-- reconciled item.
--
-- clearedAt/clearedBy are a PUTR integration boundary with recon-service
-- (S054A/S054B): recon-service is expected to set them when a check
-- actually clears/reconciles; until that cross-service wiring exists, an
-- admin/test-only endpoint sets them for certification and local testing.

ALTER TABLE "ap_manual_payments" ADD COLUMN IF NOT EXISTS "cleared_at" TIMESTAMP(3);
ALTER TABLE "ap_manual_payments" ADD COLUMN IF NOT EXISTS "cleared_by" TEXT;
ALTER TABLE "ap_manual_payments" ADD COLUMN IF NOT EXISTS "reissue_of_payment_id" TEXT;
ALTER TABLE "ap_manual_payments" ADD COLUMN IF NOT EXISTS "issue_date" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ap_stop_payment_requests" (
  "id"             TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "payment_id"      TEXT NOT NULL,
  "reason"          TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'REQUESTED',
  "bank_ack"        TEXT NOT NULL DEFAULT 'PAYMENT_RAIL_NOT_CONFIGURED',
  "bank_ack_note"   TEXT,
  "requested_by"    TEXT,
  "requested_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at"     TIMESTAMP(3),
  "resolved_by"     TEXT,

  CONSTRAINT "ap_stop_payment_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ap_stop_payment_requests_tenant_id_idx" ON "ap_stop_payment_requests"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_stop_payment_requests_tenant_id_payment_id_idx" ON "ap_stop_payment_requests"("tenant_id", "payment_id");

CREATE TABLE IF NOT EXISTS "ap_escheat_jurisdiction_configs" (
  "id"           TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "jurisdiction"  TEXT NOT NULL,
  "stale_days"    INTEGER NOT NULL,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ap_escheat_jurisdiction_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_escheat_jurisdiction_configs_tenant_id_jurisdiction_key" ON "ap_escheat_jurisdiction_configs"("tenant_id", "jurisdiction");
CREATE INDEX IF NOT EXISTS "ap_escheat_jurisdiction_configs_tenant_id_idx" ON "ap_escheat_jurisdiction_configs"("tenant_id");

CREATE TABLE IF NOT EXISTS "ap_escheat_due_diligence_records" (
  "id"            TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "payment_id"     TEXT NOT NULL,
  "attempted_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method"         TEXT NOT NULL,
  "outcome"        TEXT NOT NULL,
  "notes"          TEXT,
  "performed_by"   TEXT,

  CONSTRAINT "ap_escheat_due_diligence_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ap_escheat_due_diligence_records_tenant_id_payment_id_idx" ON "ap_escheat_due_diligence_records"("tenant_id", "payment_id");

CREATE TABLE IF NOT EXISTS "ap_escheat_transfers" (
  "id"               TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "payment_id"        TEXT NOT NULL,
  "jurisdiction"      TEXT NOT NULL,
  "amount"            DECIMAL(15,2) NOT NULL,
  "status"            TEXT NOT NULL DEFAULT 'PENDING',
  "gl_entry_id"       TEXT,
  "gl_posting_error"  TEXT,
  "posted_by"         TEXT,
  "posted_at"         TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"        TEXT,

  CONSTRAINT "ap_escheat_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_escheat_transfers_payment_id_key" ON "ap_escheat_transfers"("payment_id");
CREATE INDEX IF NOT EXISTS "ap_escheat_transfers_tenant_id_idx" ON "ap_escheat_transfers"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_escheat_transfers_tenant_id_jurisdiction_idx" ON "ap_escheat_transfers"("tenant_id", "jurisdiction");

CREATE TABLE IF NOT EXISTS "ap_escheat_gl_account_configs" (
  "tenant_id"                       TEXT NOT NULL,
  "outstanding_checks_gl_account_id" TEXT,
  "escheat_payable_gl_account_id"    TEXT,
  "created_at"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ap_escheat_gl_account_configs_pkey" PRIMARY KEY ("tenant_id")
);

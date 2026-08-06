-- CE-09 S043B: AP Payment Runs & Rails.
--
-- Proposal (invoice selection) -> approval (SoD: proposedBy != approvedBy,
-- enforced in PaymentRunService.approveRun, not by a DB constraint) ->
-- execution (per-invoice payments, each in its own transaction so a single
-- invoice's failure never blocks the rest of the run) -> rail artifacts
-- (check-print / positive-pay / ACH-NACHA file, file-generation-only is a
-- valid completed outcome; PAYMENT_RAIL_NOT_CONFIGURED is the truthful
-- adapter state, same precedent as S045's ApStopPaymentRequest.bankAck).

CREATE TABLE IF NOT EXISTS "ap_payment_runs" (
  "id"                     TEXT NOT NULL,
  "tenant_id"              TEXT NOT NULL,
  "bank_account_id"        TEXT NOT NULL,
  "status"                 TEXT NOT NULL DEFAULT 'PROPOSED',
  "due_date_through"       DATE NOT NULL,
  "discount_date_through"  DATE,
  "vendor_filter"          JSONB,
  "cash_requirement_total" DECIMAL(15,2) NOT NULL DEFAULT 0,
  "proposed_by"            TEXT NOT NULL,
  "proposed_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by"            TEXT,
  "approved_at"            TIMESTAMP(3),
  "rejected_by"            TEXT,
  "rejected_at"            TIMESTAMP(3),
  "rejection_reason"       TEXT,
  "executed_by"            TEXT,
  "executed_at"            TIMESTAMP(3),
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_payment_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ap_payment_runs_tenant_id_idx" ON "ap_payment_runs"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_payment_runs_tenant_id_status_idx" ON "ap_payment_runs"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "ap_payment_run_items" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "run_id"         TEXT NOT NULL,
  "invoice_id"     TEXT NOT NULL,
  "vendor_id"      TEXT NOT NULL,
  "amount"         DECIMAL(15,2) NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'PENDING',
  "payment_id"     TEXT,
  "check_number"   INTEGER,
  "failure_reason" TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_payment_run_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ap_payment_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ap_payment_runs"("id")
);

CREATE INDEX IF NOT EXISTS "ap_payment_run_items_tenant_id_idx" ON "ap_payment_run_items"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_payment_run_items_tenant_id_run_id_idx" ON "ap_payment_run_items"("tenant_id", "run_id");
CREATE INDEX IF NOT EXISTS "ap_payment_run_items_tenant_id_invoice_id_idx" ON "ap_payment_run_items"("tenant_id", "invoice_id");

CREATE TABLE IF NOT EXISTS "ap_payment_run_rail_artifacts" (
  "id"            TEXT NOT NULL,
  "tenant_id"     TEXT NOT NULL,
  "run_id"        TEXT NOT NULL,
  "mode"          TEXT NOT NULL,
  "status"        TEXT NOT NULL,
  "file_content"  TEXT NOT NULL,
  "total_amount"  DECIMAL(15,2) NOT NULL,
  "item_count"    INTEGER NOT NULL,
  "generated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generated_by"  TEXT,

  CONSTRAINT "ap_payment_run_rail_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ap_payment_run_rail_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ap_payment_runs"("id")
);

CREATE INDEX IF NOT EXISTS "ap_payment_run_rail_artifacts_tenant_id_idx" ON "ap_payment_run_rail_artifacts"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_payment_run_rail_artifacts_tenant_id_run_id_idx" ON "ap_payment_run_rail_artifacts"("tenant_id", "run_id");

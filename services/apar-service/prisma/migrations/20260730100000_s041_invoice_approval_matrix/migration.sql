-- AMACC-CH04 S041: Invoice Approval Matrix.
--
-- S041 is registered in the Fable canonical registry only as a summary row
-- (id S041, epic CE-09, release R2) — status EXPANSION_PENDING, no accepted
-- thresholds/roles/workflow exist. Built as a configurable framework: a
-- tenant defines its own tiers (ap_invoice_approval_rules); no dollar
-- threshold or approval policy is hard-coded/invented. Approval/posting
-- authority is layered directly on top of S039's VendorInvoice.status
-- (SUBMITTED -> PENDING_APPROVAL -> APPROVED/REJECTED).

ALTER TABLE "vendor_invoices" ADD COLUMN IF NOT EXISTS "approval_gl_entry_id" TEXT;

CREATE TABLE IF NOT EXISTS "ap_invoice_approval_rules" (
  "id"                TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "threshold_amount"  DECIMAL(15,2) NOT NULL,
  "required_role"     TEXT NOT NULL,
  "sequence"          INTEGER NOT NULL,
  "is_active"         BOOLEAN NOT NULL DEFAULT true,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ap_invoice_approval_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_invoice_approval_rules_tenant_sequence_key" ON "ap_invoice_approval_rules"("tenant_id", "sequence");
CREATE INDEX IF NOT EXISTS "ap_invoice_approval_rules_tenant_id_is_active_idx" ON "ap_invoice_approval_rules"("tenant_id", "is_active");

CREATE TABLE IF NOT EXISTS "ap_invoice_approval_instances" (
  "id"                    TEXT NOT NULL,
  "tenant_id"             TEXT NOT NULL,
  "invoice_id"            TEXT NOT NULL,
  "status"                TEXT NOT NULL DEFAULT 'PENDING',
  "total_amount_snapshot" DECIMAL(15,2) NOT NULL,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"            TEXT,
  "completed_at"          TIMESTAMP(3),

  CONSTRAINT "ap_invoice_approval_instances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_invoice_approval_instances_invoice_id_key" ON "ap_invoice_approval_instances"("invoice_id");
CREATE INDEX IF NOT EXISTS "ap_invoice_approval_instances_tenant_id_idx" ON "ap_invoice_approval_instances"("tenant_id");
CREATE INDEX IF NOT EXISTS "ap_invoice_approval_instances_tenant_id_status_idx" ON "ap_invoice_approval_instances"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "ap_invoice_approval_steps" (
  "id"            TEXT NOT NULL,
  "instance_id"   TEXT NOT NULL,
  "sequence"      INTEGER NOT NULL,
  "required_role" TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'PENDING',
  "decided_by"    TEXT,
  "decided_at"    TIMESTAMP(3),
  "note"          TEXT,

  CONSTRAINT "ap_invoice_approval_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ap_invoice_approval_steps_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "ap_invoice_approval_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_invoice_approval_steps_instance_sequence_key" ON "ap_invoice_approval_steps"("instance_id", "sequence");
CREATE INDEX IF NOT EXISTS "ap_invoice_approval_steps_instance_id_idx" ON "ap_invoice_approval_steps"("instance_id");

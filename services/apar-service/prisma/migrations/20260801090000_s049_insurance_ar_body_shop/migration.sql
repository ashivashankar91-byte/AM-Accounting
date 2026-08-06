-- CE-09 S049: Insurance AR (Body Shop).
--
-- Models the insurer as a payer distinct from the customer: a
-- claim-linked receivable (claim number, insurer identity, customer
-- reference, RO reference field — PUTR: RO linkage is reference-only, no
-- CE-11 logic), supplement tracking (claim amount revisions posted as
-- governed adjustment journals via the engine — never a raw edit of the
-- claim amount, so the original claim_amount column is never updated
-- in-place by a supplement), and a short-pay disposition workflow.

CREATE TABLE IF NOT EXISTS "ar_insurance_claims" (
  "id"                    TEXT NOT NULL,
  "tenant_id"             TEXT NOT NULL,
  "customer_id"           TEXT NOT NULL,
  "insurer_name"          TEXT NOT NULL,
  "insurer_reference"     TEXT,
  "claim_number"          TEXT NOT NULL,
  "ro_reference"          TEXT,
  "claim_amount"          DECIMAL(15,2) NOT NULL,
  "amount_applied"        DECIMAL(15,2) NOT NULL DEFAULT 0,
  "status"                TEXT NOT NULL DEFAULT 'OPEN',
  "short_pay_disposed_at" TIMESTAMP(3),
  "gl_entry_id"           TEXT,
  "gl_posting_error"      TEXT,
  "created_by"            TEXT NOT NULL,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_insurance_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ar_insurance_claims_tenant_id_idx" ON "ar_insurance_claims"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_insurance_claims_tenant_id_customer_id_idx" ON "ar_insurance_claims"("tenant_id", "customer_id");
CREATE INDEX IF NOT EXISTS "ar_insurance_claims_tenant_id_claim_number_idx" ON "ar_insurance_claims"("tenant_id", "claim_number");

CREATE TABLE IF NOT EXISTS "ar_insurance_claim_supplements" (
  "id"                TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "claim_id"          TEXT NOT NULL,
  "adjustment_amount" DECIMAL(15,2) NOT NULL,
  "reason"            TEXT NOT NULL,
  "gl_entry_id"       TEXT,
  "gl_posting_error"  TEXT,
  "created_by"        TEXT NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_insurance_claim_supplements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ar_insurance_claim_supplements_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "ar_insurance_claims"("id")
);

CREATE INDEX IF NOT EXISTS "ar_insurance_claim_supplements_tenant_id_idx" ON "ar_insurance_claim_supplements"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_insurance_claim_supplements_tenant_id_claim_id_idx" ON "ar_insurance_claim_supplements"("tenant_id", "claim_id");

CREATE TABLE IF NOT EXISTS "ar_insurance_payment_applications" (
  "id"          TEXT NOT NULL,
  "tenant_id"   TEXT NOT NULL,
  "claim_id"    TEXT NOT NULL,
  "amount"      DECIMAL(15,2) NOT NULL,
  "gl_entry_id" TEXT,
  "gl_posting_error" TEXT,
  "created_by"  TEXT NOT NULL,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_insurance_payment_applications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ar_insurance_payment_applications_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "ar_insurance_claims"("id")
);

CREATE INDEX IF NOT EXISTS "ar_insurance_payment_applications_tenant_id_idx" ON "ar_insurance_payment_applications"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_insurance_payment_applications_tenant_id_claim_id_idx" ON "ar_insurance_payment_applications"("tenant_id", "claim_id");

CREATE TABLE IF NOT EXISTS "ar_insurance_short_pay_dispositions" (
  "id"                 TEXT NOT NULL,
  "tenant_id"          TEXT NOT NULL,
  "claim_id"           TEXT NOT NULL,
  "amount"             DECIMAL(15,2) NOT NULL,
  "disposition_type"   TEXT NOT NULL,
  "reason"             TEXT NOT NULL,
  "gl_entry_id"        TEXT,
  "gl_posting_error"   TEXT,
  "created_by"         TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_insurance_short_pay_dispositions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ar_insurance_short_pay_dispositions_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "ar_insurance_claims"("id")
);

CREATE INDEX IF NOT EXISTS "ar_insurance_short_pay_dispositions_tenant_id_idx" ON "ar_insurance_short_pay_dispositions"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_insurance_short_pay_dispositions_tenant_id_claim_id_idx" ON "ar_insurance_short_pay_dispositions"("tenant_id", "claim_id");

CREATE TABLE IF NOT EXISTS "ar_insurance_gl_account_configs" (
  "tenant_id"                    TEXT NOT NULL,
  "ar_insurer_control_gl_account_id" TEXT,
  "revenue_gl_account_id"        TEXT,
  "ar_customer_control_gl_account_id" TEXT,
  "write_off_expense_gl_account_id" TEXT,
  "updated_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_insurance_gl_account_configs_pkey" PRIMARY KEY ("tenant_id")
);

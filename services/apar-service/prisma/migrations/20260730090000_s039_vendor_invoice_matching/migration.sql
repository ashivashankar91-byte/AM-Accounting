-- AMACC-CH04 S039: AP Invoice Entry & 2/3-Way Match.
--
-- S039 is registered in the Fable canonical registry (docs/accounting-
-- modernization/AutoMate2_Accounting_Backlog_Package_v1.1.zip) only as a
-- summary row (id S039, epic CE-09, release R2) — status EXPANSION_PENDING,
-- no accepted acceptance criteria/field list exists. Built as a configurable
-- framework per the Fable Source-of-Truth Gate fallback: matching tolerance
-- is tenant/vendor-configurable (ap_invoice_match_tolerance_configs,
-- conservative 0.00 default), GL coding references the existing gl_accounts
-- reference data (no fabricated account numbers), and approval/posting
-- authority is explicitly out of scope — see S041 Invoice Approval Matrix.
--
-- Additive-only. Reuses the existing S6-01 purchase_orders/po_lines and
-- S036A vendors tables — no parallel PO or vendor system introduced.
-- goods_receipts/goods_receipt_lines are new: no receiving model existed
-- anywhere in the repository before this migration (confirmed during S039
-- discovery) and 3-way match requires one.

CREATE TABLE IF NOT EXISTS "goods_receipts" (
  "id"              TEXT NOT NULL,
  "tenant_id"       TEXT NOT NULL,
  "po_id"           TEXT NOT NULL,
  "receipt_number"  TEXT NOT NULL,
  "receipt_date"    DATE NOT NULL DEFAULT CURRENT_DATE,
  "received_by"     TEXT,
  "status"          TEXT NOT NULL DEFAULT 'OPEN',
  "notes"           TEXT,
  "voided_at"       TIMESTAMP(3),
  "voided_by"       TEXT,
  "void_reason"     TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"      TEXT,

  CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "goods_receipts_tenant_id_idx" ON "goods_receipts"("tenant_id");
CREATE INDEX IF NOT EXISTS "goods_receipts_tenant_id_po_id_idx" ON "goods_receipts"("tenant_id", "po_id");
CREATE INDEX IF NOT EXISTS "goods_receipts_tenant_id_status_idx" ON "goods_receipts"("tenant_id", "status");

CREATE TABLE IF NOT EXISTS "goods_receipt_lines" (
  "id"            TEXT NOT NULL,
  "receipt_id"    TEXT NOT NULL,
  "po_line_id"    TEXT NOT NULL,
  "line_number"   INTEGER NOT NULL,
  "description"   TEXT NOT NULL,
  "qty_received"  DECIMAL(10,2) NOT NULL,

  CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goods_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "goods_receipt_lines_receipt_id_idx" ON "goods_receipt_lines"("receipt_id");
CREATE INDEX IF NOT EXISTS "goods_receipt_lines_po_line_id_idx" ON "goods_receipt_lines"("po_line_id");

CREATE TABLE IF NOT EXISTS "vendor_invoices" (
  "id"                        TEXT NOT NULL,
  "tenant_id"                 TEXT NOT NULL,
  "vendor_id"                 TEXT NOT NULL,
  "invoice_number"            TEXT NOT NULL,
  "normalized_invoice_number" TEXT NOT NULL,
  "invoice_date"              DATE NOT NULL,
  "due_date"                  DATE NOT NULL,
  "payment_terms"             TEXT NOT NULL,
  "po_id"                     TEXT,
  "subtotal"                  DECIMAL(15,2) NOT NULL DEFAULT 0,
  "tax_amount"                DECIMAL(15,2) NOT NULL DEFAULT 0,
  "freight_amount"            DECIMAL(15,2) NOT NULL DEFAULT 0,
  "total_amount"              DECIMAL(15,2) NOT NULL DEFAULT 0,
  "status"                    TEXT NOT NULL DEFAULT 'DRAFT',
  "match_type"                TEXT NOT NULL DEFAULT 'NONE',
  "match_status"              TEXT NOT NULL DEFAULT 'NOT_RUN',
  "notes"                     TEXT,
  "version"                   INTEGER NOT NULL DEFAULT 1,
  "submitted_at"              TIMESTAMP(3),
  "submitted_by"              TEXT,
  "voided_at"                 TIMESTAMP(3),
  "voided_by"                 TEXT,
  "void_reason"               TEXT,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by"                TEXT,
  "updated_at"                TIMESTAMP(3) NOT NULL,
  "updated_by"                TEXT,

  CONSTRAINT "vendor_invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vendor_invoices_tenant_id_idx" ON "vendor_invoices"("tenant_id");
CREATE INDEX IF NOT EXISTS "vendor_invoices_tenant_id_vendor_id_idx" ON "vendor_invoices"("tenant_id", "vendor_id");
CREATE INDEX IF NOT EXISTS "vendor_invoices_tenant_id_status_idx" ON "vendor_invoices"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "vendor_invoices_tenant_id_po_id_idx" ON "vendor_invoices"("tenant_id", "po_id");
CREATE INDEX IF NOT EXISTS "vendor_invoices_tenant_id_normalized_invoice_number_idx" ON "vendor_invoices"("tenant_id", "normalized_invoice_number");

CREATE TABLE IF NOT EXISTS "vendor_invoice_lines" (
  "id"           TEXT NOT NULL,
  "invoice_id"   TEXT NOT NULL,
  "line_number"  INTEGER NOT NULL,
  "po_line_id"   TEXT,
  "gl_account_id" TEXT,
  "description"  TEXT NOT NULL,
  "quantity"     DECIMAL(10,2) NOT NULL DEFAULT 1,
  "unit_price"   DECIMAL(15,2) NOT NULL,
  "tax_amount"   DECIMAL(15,2) NOT NULL DEFAULT 0,
  "line_total"   DECIMAL(15,2) NOT NULL,

  CONSTRAINT "vendor_invoice_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vendor_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Exactly one of po_line_id / gl_account_id must be set — a line is either
  -- matched against a PO line or directly GL-coded, never both/neither.
  CONSTRAINT "vendor_invoice_lines_po_or_gl_chk" CHECK (
    ("po_line_id" IS NOT NULL AND "gl_account_id" IS NULL) OR
    ("po_line_id" IS NULL AND "gl_account_id" IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS "vendor_invoice_lines_invoice_id_idx" ON "vendor_invoice_lines"("invoice_id");
CREATE INDEX IF NOT EXISTS "vendor_invoice_lines_po_line_id_idx" ON "vendor_invoice_lines"("po_line_id");

CREATE TABLE IF NOT EXISTS "vendor_invoice_match_results" (
  "id"                      TEXT NOT NULL,
  "tenant_id"               TEXT NOT NULL,
  "invoice_id"              TEXT NOT NULL,
  "match_type"              TEXT NOT NULL,
  "status"                  TEXT NOT NULL,
  "tolerance_amount_used"   DECIMAL(15,2) NOT NULL,
  "tolerance_percent_used"  DECIMAL(5,2) NOT NULL,
  "variances"               JSONB NOT NULL,
  "matched_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "matched_by"              TEXT,

  CONSTRAINT "vendor_invoice_match_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vendor_invoice_match_results_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vendor_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "vendor_invoice_match_results_tenant_id_invoice_id_idx" ON "vendor_invoice_match_results"("tenant_id", "invoice_id");

CREATE TABLE IF NOT EXISTS "ap_invoice_match_tolerance_configs" (
  "id"                 TEXT NOT NULL,
  "tenant_id"          TEXT NOT NULL,
  "scope"              TEXT NOT NULL,
  "scope_id"           TEXT,
  "amount_tolerance"   DECIMAL(15,2) NOT NULL DEFAULT 0,
  "percent_tolerance"  DECIMAL(5,2) NOT NULL DEFAULT 0,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ap_invoice_match_tolerance_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ap_invoice_match_tolerance_configs_tenant_scope_key"
  ON "ap_invoice_match_tolerance_configs"("tenant_id", "scope", "scope_id");
CREATE INDEX IF NOT EXISTS "ap_invoice_match_tolerance_configs_tenant_id_idx" ON "ap_invoice_match_tolerance_configs"("tenant_id");

CREATE TABLE IF NOT EXISTS "ap_invoice_match_overrides" (
  "id"             TEXT NOT NULL,
  "tenant_id"      TEXT NOT NULL,
  "invoice_id"     TEXT NOT NULL,
  "override_type"  TEXT NOT NULL,
  "context"        JSONB NOT NULL,
  "reason"         TEXT NOT NULL,
  "actor"          TEXT NOT NULL,
  "correlation_id" TEXT,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ap_invoice_match_overrides_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ap_invoice_match_overrides_tenant_id_invoice_id_idx" ON "ap_invoice_match_overrides"("tenant_id", "invoice_id");

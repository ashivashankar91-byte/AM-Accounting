-- CE-09 S047: Fleet AR Consolidated Billing.
--
-- Parent-child customer linkage (fleet parent + unit/sub-account
-- customers), a billing-group construct, and consolidated invoices that
-- create per-unit AR items while producing one consolidated document for
-- the parent. Conservation is enforced structurally: an
-- ArConsolidatedInvoice's total_amount is always computed as the sum of
-- its own ArConsolidatedInvoiceItem rows (never independently supplied),
-- and each item carries consolidated_invoice_id as its lineage back to the
-- consolidated document.

CREATE TABLE IF NOT EXISTS "ar_fleet_unit_links" (
  "id"                TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "parent_customer_id" TEXT NOT NULL,
  "child_customer_id"  TEXT NOT NULL,
  "billing_group_name" TEXT,
  "created_by"         TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_fleet_unit_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ar_fleet_unit_links_tenant_id_idx" ON "ar_fleet_unit_links"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_fleet_unit_links_tenant_id_parent_customer_id_idx" ON "ar_fleet_unit_links"("tenant_id", "parent_customer_id");
-- A unit customer can only belong to one fleet parent at a time.
CREATE UNIQUE INDEX IF NOT EXISTS "ar_fleet_unit_links_tenant_id_child_customer_id_key" ON "ar_fleet_unit_links"("tenant_id", "child_customer_id");

CREATE TABLE IF NOT EXISTS "ar_consolidated_invoices" (
  "id"                TEXT NOT NULL,
  "tenant_id"         TEXT NOT NULL,
  "parent_customer_id" TEXT NOT NULL,
  "invoice_date"       DATE NOT NULL,
  "total_amount"       DECIMAL(15,2) NOT NULL DEFAULT 0,
  "status"             TEXT NOT NULL DEFAULT 'POSTED',
  "gl_entry_id"        TEXT,
  "gl_posting_error"   TEXT,
  "created_by"         TEXT NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_consolidated_invoices_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ar_consolidated_invoices_tenant_id_idx" ON "ar_consolidated_invoices"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_consolidated_invoices_tenant_id_parent_customer_id_idx" ON "ar_consolidated_invoices"("tenant_id", "parent_customer_id");

CREATE TABLE IF NOT EXISTS "ar_consolidated_invoice_items" (
  "id"                      TEXT NOT NULL,
  "tenant_id"               TEXT NOT NULL,
  "consolidated_invoice_id" TEXT NOT NULL,
  "child_customer_id"       TEXT NOT NULL,
  "amount"                  DECIMAL(15,2) NOT NULL,
  "description"             TEXT,
  "status"                  TEXT NOT NULL DEFAULT 'OPEN',
  "created_at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_consolidated_invoice_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ar_consolidated_invoice_items_consolidated_invoice_id_fkey" FOREIGN KEY ("consolidated_invoice_id") REFERENCES "ar_consolidated_invoices"("id")
);

CREATE INDEX IF NOT EXISTS "ar_consolidated_invoice_items_tenant_id_idx" ON "ar_consolidated_invoice_items"("tenant_id");
CREATE INDEX IF NOT EXISTS "ar_consolidated_invoice_items_tenant_id_ci_id_idx" ON "ar_consolidated_invoice_items"("tenant_id", "consolidated_invoice_id");
CREATE INDEX IF NOT EXISTS "ar_consolidated_invoice_items_tenant_id_child_customer_id_idx" ON "ar_consolidated_invoice_items"("tenant_id", "child_customer_id");

CREATE TABLE IF NOT EXISTS "ar_fleet_billing_gl_account_configs" (
  "tenant_id"               TEXT NOT NULL,
  "ar_control_gl_account_id" TEXT,
  "revenue_gl_account_id"    TEXT,
  "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ar_fleet_billing_gl_account_configs_pkey" PRIMARY KEY ("tenant_id")
);

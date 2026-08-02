-- Gap-closure — Due-Bill / We-Owe items (schedule 91, GL DUE_BILL_PAYABLE
-- 19226). Additive-only: new table, new RLS policy set, no existing
-- schema touched.

CREATE TABLE "due_bill" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "deal_id" TEXT NOT NULL,
  "item_description" TEXT NOT NULL,
  "amount" DECIMAL(15,2) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "posting_record_id" TEXT,
  "event_id" TEXT NOT NULL,
  "coa_status" TEXT NOT NULL,
  "journal_entry_id" TEXT,
  "journal_number" TEXT,
  "fulfilled_at" TIMESTAMP(3),
  "fulfilled_by" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT NOT NULL,

  CONSTRAINT "due_bill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "due_bill_tenant_id_idempotency_key_key" ON "due_bill"("tenant_id", "idempotency_key");
CREATE INDEX "due_bill_tenant_id_deal_id_idx" ON "due_bill"("tenant_id", "deal_id");
CREATE INDEX "due_bill_tenant_id_status_idx" ON "due_bill"("tenant_id", "status");

ALTER TABLE "due_bill" ADD CONSTRAINT "due_bill_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS — same 4-policy pattern as 20260802010001_add_rls_policies_deal_accounting_svc.
ALTER TABLE "due_bill" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "due_bill" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON "due_bill" FOR SELECT USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation_insert ON "due_bill" FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation_update ON "due_bill" FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY tenant_isolation_delete ON "due_bill" FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "due_bill" TO amacc_rls_bypass;

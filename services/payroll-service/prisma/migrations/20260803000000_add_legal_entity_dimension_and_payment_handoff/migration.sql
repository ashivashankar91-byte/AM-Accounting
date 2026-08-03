-- fix(integration): CE-13 payroll gap-closure — real legal-entity dimension
-- (replaces the temporary legalEntityId=tenantId substitution) and the
-- CE-09 payment-handoff evidence table.
--
-- Additive only. Every new column is nullable: pre-existing rows predate
-- the legal-entity dimension and cannot be unambiguously backfilled (no
-- column ever recorded which legal entity a row belonged to), so they are
-- left NULL rather than silently assigned tenantId as legalEntityId. The
-- application layer (payroll-service.ts / commission-service.ts / etc.)
-- refuses to validate/approve/post/void/activate any row whose
-- legalEntityId is NULL — it must first be reconciled (an explicit
-- LEGAL_ENTITY_RECONCILIATION_REQUIRED refusal, never a silent default).

ALTER TABLE "employees" ADD COLUMN "legal_entity_id" TEXT;
CREATE INDEX "employees_tenant_id_legal_entity_id_idx" ON "employees" ("tenant_id", "legal_entity_id");

ALTER TABLE "payroll_batches" ADD COLUMN "legal_entity_id" TEXT;
CREATE INDEX "payroll_batches_tenant_id_legal_entity_id_idx" ON "payroll_batches" ("tenant_id", "legal_entity_id");
DROP INDEX IF EXISTS "payroll_batches_tenant_id_provider_run_id_pay_period_start__key";
CREATE UNIQUE INDEX "payroll_batches_tenant_id_legal_entity_id_provider_run_id_pp_key" ON "payroll_batches" ("tenant_id", "legal_entity_id", "provider_run_id", "pay_period_start", "pay_period_end");

ALTER TABLE "payroll_items" ADD COLUMN "legal_entity_id" TEXT;
CREATE INDEX "payroll_items_tenant_id_legal_entity_id_idx" ON "payroll_items" ("tenant_id", "legal_entity_id");

ALTER TABLE "payroll_tenant_config" ADD COLUMN "legal_entity_id" TEXT;
ALTER TABLE "payroll_tenant_config" ADD COLUMN "payment_handoff_mode" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED';
DROP INDEX IF EXISTS "payroll_tenant_config_tenant_id_key";
CREATE UNIQUE INDEX "payroll_tenant_config_tenant_id_legal_entity_id_key" ON "payroll_tenant_config" ("tenant_id", "legal_entity_id");

ALTER TABLE "payroll_rule_pack_version" ADD COLUMN "legal_entity_id" TEXT;
DROP INDEX IF EXISTS "payroll_rule_pack_version_tenant_id_pack_key_version_key";
CREATE UNIQUE INDEX "payroll_rule_pack_version_tenant_id_legal_entity_id_pack_key_v_key" ON "payroll_rule_pack_version" ("tenant_id", "legal_entity_id", "pack_key", "version");
CREATE INDEX "payroll_rule_pack_version_tenant_id_legal_entity_id_status_idx" ON "payroll_rule_pack_version" ("tenant_id", "legal_entity_id", "status");

ALTER TABLE "clawback_records" ADD COLUMN "legal_entity_id" TEXT;
DROP INDEX IF EXISTS "clawback_records_tenant_id_deal_id_employee_id_method_key";
CREATE UNIQUE INDEX "clawback_records_tenant_id_legal_entity_id_deal_id_employee_id_key" ON "clawback_records" ("tenant_id", "legal_entity_id", "deal_id", "employee_id", "method");
CREATE INDEX "clawback_records_tenant_id_legal_entity_id_idx" ON "clawback_records" ("tenant_id", "legal_entity_id");

ALTER TABLE "accrual_entries" ADD COLUMN "legal_entity_id" TEXT;
DROP INDEX IF EXISTS "accrual_entries_tenant_id_period_year_period_month_accrual_key";
CREATE UNIQUE INDEX "accrual_entries_tenant_id_legal_entity_id_period_year_period_m_key" ON "accrual_entries" ("tenant_id", "legal_entity_id", "period_year", "period_month", "accrual_type", "department");
CREATE INDEX "accrual_entries_tenant_id_legal_entity_id_idx" ON "accrual_entries" ("tenant_id", "legal_entity_id");

ALTER TABLE "tech_flag_bridge_entries" ADD COLUMN "legal_entity_id" TEXT;
CREATE INDEX "tech_flag_bridge_entries_tenant_id_legal_entity_id_idx" ON "tech_flag_bridge_entries" ("tenant_id", "legal_entity_id");

ALTER TABLE "commission_disputes" ADD COLUMN "legal_entity_id" TEXT;
CREATE INDEX "commission_disputes_tenant_id_legal_entity_id_idx" ON "commission_disputes" ("tenant_id", "legal_entity_id");

ALTER TABLE "payroll_sensitive_read_audit" ADD COLUMN "legal_entity_id" TEXT;

ALTER TABLE "payroll_gl_mappings" ADD COLUMN "legal_entity_id" TEXT;
DROP INDEX IF EXISTS "payroll_gl_mappings_tenant_id_department_pay_component_key";
CREATE UNIQUE INDEX "payroll_gl_mappings_tenant_id_legal_entity_id_department_pay_c_key" ON "payroll_gl_mappings" ("tenant_id", "legal_entity_id", "department", "pay_component");
CREATE INDEX "payroll_gl_mappings_tenant_id_legal_entity_id_idx" ON "payroll_gl_mappings" ("tenant_id", "legal_entity_id");

ALTER TABLE "employee_ytd" ADD COLUMN "legal_entity_id" TEXT;
CREATE INDEX "employee_ytd_tenant_id_legal_entity_id_idx" ON "employee_ytd" ("tenant_id", "legal_entity_id");

ALTER TABLE "commission_plans" ADD COLUMN "legal_entity_id" TEXT;
CREATE INDEX "commission_plans_tenant_id_legal_entity_id_idx" ON "commission_plans" ("tenant_id", "legal_entity_id");

ALTER TABLE "commission_records" ADD COLUMN "legal_entity_id" TEXT;
ALTER TABLE "commission_records" ADD COLUMN "payroll_batch_id" TEXT;
ALTER TABLE "commission_records" ADD COLUMN "reversal_journal_entry_id" TEXT;
CREATE INDEX "commission_records_tenant_id_legal_entity_id_idx" ON "commission_records" ("tenant_id", "legal_entity_id");
CREATE INDEX "commission_records_tenant_id_payroll_batch_id_idx" ON "commission_records" ("tenant_id", "payroll_batch_id");

-- @net-new fix(integration) — CE-09 payroll payment handoff evidence.
CREATE TABLE "payroll_payment_handoffs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "legal_entity_id" TEXT,
  "payroll_batch_id" TEXT NOT NULL,
  "journal_entry_id" TEXT NOT NULL,
  "clearing_gl_account_code" TEXT NOT NULL,
  "total_amount" DECIMAL(15,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  "idempotency_key" TEXT NOT NULL,
  "settlement_reference" TEXT,
  "failure_reason" TEXT,
  "voided_at" TIMESTAMP(3),
  "void_reason" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "settled_at" TIMESTAMP(3),

  CONSTRAINT "payroll_payment_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_payment_handoffs_tenant_id_idempotency_key_key" ON "payroll_payment_handoffs" ("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "payroll_payment_handoffs_tenant_id_payroll_batch_id_key" ON "payroll_payment_handoffs" ("tenant_id", "payroll_batch_id");
CREATE INDEX "payroll_payment_handoffs_tenant_id_legal_entity_id_idx" ON "payroll_payment_handoffs" ("tenant_id", "legal_entity_id");
CREATE INDEX "payroll_payment_handoffs_tenant_id_status_idx" ON "payroll_payment_handoffs" ("tenant_id", "status");

-- RLS: mirrors 20260802000001_add_rls_policies_payroll_svc's existing
-- tenant-scoped FORCE RLS convention for every new/RLS-eligible table.
ALTER TABLE "payroll_payment_handoffs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_payment_handoffs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_select" ON "payroll_payment_handoffs" FOR SELECT
  USING (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY "tenant_isolation_insert" ON "payroll_payment_handoffs" FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY "tenant_isolation_update" ON "payroll_payment_handoffs" FOR UPDATE
  USING (tenant_id = current_setting('app.current_tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
CREATE POLICY "tenant_isolation_delete" ON "payroll_payment_handoffs" FOR DELETE
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- amacc_app's DML grant is automatic (ALTER DEFAULT PRIVILEGES in
-- infra/postgres/init/01-create-app-role.sql); amacc_rls_bypass mirrors
-- 20260802000001_add_rls_policies_payroll_svc's existing convention for
-- every other RLS-enabled payroll table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_payment_handoffs" TO amacc_rls_bypass;

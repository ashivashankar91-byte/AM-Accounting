-- CE-13 — Payroll epic: statutory-boundary, governed-posting, S025 rule-pack
-- governance, commission (S109) splits/draws, chargeback/clawback (S110),
-- accruals (S111), tech flag-hour bridge (S112).
--
-- Additive only: no historical migration is altered, no column is dropped
-- or renamed, no existing NOT NULL is tightened against nullable existing
-- data. New columns are nullable or carry a truthful default
-- ('NOT_CONFIGURED') so existing rows remain valid.

-- ── payroll_batches: statutory-source mode, provider-run idempotency, ─────
--    governed-posting draft/final linkage, S025 rule-pack pin, S218 void/
--    adjustment-run linkage.
ALTER TABLE "payroll_batches"
  ADD COLUMN "payroll_source_mode" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "provider_run_id" TEXT,
  ADD COLUMN "gl_draft_journal_id" TEXT,
  ADD COLUMN "rule_pack_version_id" TEXT,
  ADD COLUMN "reversal_of_batch_id" TEXT,
  ADD COLUMN "reversed_by_batch_id" TEXT,
  ADD COLUMN "is_adjustment_run" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "hold_reason" TEXT,
  ADD COLUMN "held_by" TEXT,
  ADD COLUMN "held_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "payroll_batches_tenant_id_provider_run_id_pay_period_start__key"
  ON "payroll_batches"("tenant_id", "provider_run_id", "pay_period_start", "pay_period_end");

-- ── payroll_items: withholding boundary (never computed — attested or ────
--    labeled fixture only).
ALTER TABLE "payroll_items"
  ADD COLUMN "withholding_status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "withholding_source" TEXT,
  ADD COLUMN "attested_by" TEXT,
  ADD COLUMN "attested_at" TIMESTAMP(3),
  ADD COLUMN "source_document_ref" TEXT;

-- ── payroll_tenant_config: per-tenant statutory-source mode (NOT_CONFIGURED
--    default; NullPayrollSource truthful boundary). ──────────────────────
CREATE TABLE "payroll_tenant_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payroll_source_mode" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_tenant_config_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_tenant_config_tenant_id_key" ON "payroll_tenant_config"("tenant_id");

-- ── payroll_rule_pack_version: S025 governance (author != activator, ─────
--    versioned, one ACTIVE per packKey, blank-row-tolerant mapping matrix).
CREATE TABLE "payroll_rule_pack_version" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pack_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "rows" JSONB NOT NULL,
    "author" TEXT NOT NULL,
    "activated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validated_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "payroll_rule_pack_version_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_rule_pack_version_tenant_id_pack_key_version_key" ON "payroll_rule_pack_version"("tenant_id", "pack_key", "version");
CREATE INDEX "payroll_rule_pack_version_tenant_id_pack_key_status_idx" ON "payroll_rule_pack_version"("tenant_id", "pack_key", "status");

-- ── clawback_records: S110 chargeback/clawback consumption. ──────────────
CREATE TABLE "clawback_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "original_commission_record_id" TEXT,
    "method" TEXT NOT NULL,
    "clawback_amount" DECIMAL(15,2) NOT NULL,
    "remaining_payable" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "receivable_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "journal_entry_id" TEXT,
    "source_event_id" TEXT,
    "source_event_type" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "clawback_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "clawback_records_tenant_id_deal_id_employee_id_method_key" ON "clawback_records"("tenant_id", "deal_id", "employee_id", "method");
CREATE INDEX "clawback_records_tenant_id_employee_id_idx" ON "clawback_records"("tenant_id", "employee_id");
CREATE INDEX "clawback_records_tenant_id_status_idx" ON "clawback_records"("tenant_id", "status");

-- ── accrual_entries: S111 period-end compensation accruals (auto-reversing). ─
CREATE TABLE "accrual_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "accrual_type" TEXT NOT NULL,
    "basis_description" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "department" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "previewed_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "posted_journal_entry_id" TEXT,
    "reversal_journal_entry_id" TEXT,
    "auto_reverse_date" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accrual_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "accrual_entries_tenant_id_period_year_period_month_accrual_key" ON "accrual_entries"("tenant_id", "period_year", "period_month", "accrual_type", "department");
CREATE INDEX "accrual_entries_tenant_id_period_year_period_month_idx" ON "accrual_entries"("tenant_id", "period_year", "period_month");
CREATE INDEX "accrual_entries_tenant_id_status_idx" ON "accrual_entries"("tenant_id", "status");

-- ── tech_flag_bridge_entries: S112 tech flag-hour earnings bridge. ────────
CREATE TABLE "tech_flag_bridge_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "flag_hours" DECIMAL(8,2) NOT NULL,
    "flag_rate" DECIMAL(15,4),
    "guarantee_shortfall" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "earnings_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "guarantee_top_up" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "absorption_amount" DECIMAL(15,2),
    "reconciliation_status" TEXT NOT NULL DEFAULT 'PENDING',
    "status" TEXT NOT NULL DEFAULT 'RATE_GAP',
    "source_event_id" TEXT,
    "source_event_type" TEXT,
    "payroll_item_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_flag_bridge_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tech_flag_bridge_entries_tenant_id_employee_id_idx" ON "tech_flag_bridge_entries"("tenant_id", "employee_id");
CREATE INDEX "tech_flag_bridge_entries_tenant_id_status_idx" ON "tech_flag_bridge_entries"("tenant_id", "status");

-- ── commission_disputes: S109 dispute/adjustment ceremony. ────────────────
CREATE TABLE "commission_disputes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "commission_record_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "original_amount" DECIMAL(15,2) NOT NULL,
    "adjusted_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "raised_by" TEXT NOT NULL,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_disputes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "commission_disputes_tenant_id_commission_record_id_idx" ON "commission_disputes"("tenant_id", "commission_record_id");

-- ── payroll_sensitive_read_audit: masking standing rule — audit every read
--    of an individual employee's compensation detail. ────────────────────
CREATE TABLE "payroll_sensitive_read_audit" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "read_by_user_id" TEXT NOT NULL,
    "read_by_role" TEXT,
    "surface" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_sensitive_read_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_sensitive_read_audit_tenant_id_employee_id_idx" ON "payroll_sensitive_read_audit"("tenant_id", "employee_id");
CREATE INDEX "payroll_sensitive_read_audit_tenant_id_read_at_idx" ON "payroll_sensitive_read_audit"("tenant_id", "read_at");

-- ── commission_plans: splits, draws, minimum guarantee, chargeback terms,
--    plan versioning/supersession. ───────────────────────────────────────
ALTER TABLE "commission_plans"
  ADD COLUMN "split_rules" JSONB,
  ADD COLUMN "draw_amount" DECIMAL(15,2),
  ADD COLUMN "minimum_guarantee" DECIMAL(15,2),
  ADD COLUMN "chargeback_terms" JSONB,
  ADD COLUMN "superseded_by" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- ── commission_records: deal-trace snapshot ref, draw/split/clawback ─────
--    linkage. ───────────────────────────────────────────────────────────
ALTER TABLE "commission_records"
  ADD COLUMN "deal_snapshot_ref" TEXT,
  ADD COLUMN "applied_to_draw" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "split_employee_id" TEXT,
  ADD COLUMN "clawed_back_amount" DECIMAL(15,2) NOT NULL DEFAULT 0;

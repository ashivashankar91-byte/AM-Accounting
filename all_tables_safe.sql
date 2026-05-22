-- ====== gl-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "gl_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "journal_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "posted_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "agent_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "prior_period_adjustment" BOOLEAN NOT NULL DEFAULT false,
    "adjustment_reason" TEXT,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "journal_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "gl_account_id" TEXT NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memo" TEXT,
    "department_code" TEXT,
    "technician_id" TEXT,
    "ro_number" TEXT,
    "ro_line_number" INTEGER,
    "flat_rate_hours" DOUBLE PRECISION,
    "clock_hours" DOUBLE PRECISION,
    "part_number" TEXT,
    "part_quantity" DOUBLE PRECISION,
    "earning_code" TEXT,
    "deal_product_code" TEXT,
    "deal_number" TEXT,
    "vehicle_vin" TEXT,
    "module_source" TEXT,
    "labor_type" TEXT,
    "cost_type" TEXT,
    "agent_confidence" DOUBLE PRECISION,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "deal_product_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "sale_price" DOUBLE PRECISION NOT NULL,
    "dealer_cost" DOUBLE PRECISION NOT NULL,
    "gross_profit" DOUBLE PRECISION NOT NULL,
    "provider_name" TEXT,

    CONSTRAINT "deal_product_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "outbox_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "gl_accounts_tenant_id_idx" ON "gl_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "gl_accounts_tenant_id_code_key" ON "gl_accounts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_entries_tenant_id_idx" ON "journal_entries"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_entries_tenant_id_status_idx" ON "journal_entries"("tenant_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_entries_tenant_id_source_ref_idx" ON "journal_entries"("tenant_id", "source_ref");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_lines_journal_entry_id_idx" ON "journal_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_lines_department_code_idx" ON "journal_lines"("department_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_lines_technician_id_idx" ON "journal_lines"("technician_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_lines_part_number_idx" ON "journal_lines"("part_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_lines_module_source_idx" ON "journal_lines"("module_source");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_lines_deal_number_idx" ON "journal_lines"("deal_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "journal_lines_ro_number_idx" ON "journal_lines"("ro_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deal_product_lines_journal_entry_id_idx" ON "deal_product_lines"("journal_entry_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "deal_product_lines_deal_number_idx" ON "deal_product_lines"("deal_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_published_at_idx" ON "outbox_events"("published_at");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_product_lines" ADD CONSTRAINT "deal_product_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ====== audit-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "previous_state" JSONB,
    "new_state" JSONB,
    "reason" TEXT,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "session_id" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_occurred_at_idx" ON "audit_logs"("occurred_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_event_type_idx" ON "audit_logs"("tenant_id", "event_type");



-- ====== payroll-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "payroll_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_ref" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),
    "held_reason" TEXT,
    "created_by_user_id" TEXT,
    "approved_by_user_id" TEXT,

    CONSTRAINT "payroll_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "payroll_lines" (
    "id" TEXT NOT NULL,
    "payroll_batch_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "employee_name" TEXT NOT NULL,
    "department_code" TEXT NOT NULL,
    "earning_code" TEXT NOT NULL,
    "hours" DOUBLE PRECISION,
    "rate" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION NOT NULL,
    "technician_id" TEXT,
    "flat_rate_hours" DOUBLE PRECISION,
    "ro_number" TEXT,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "outbox_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payroll_batches_tenant_id_idx" ON "payroll_batches"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payroll_batches_tenant_id_status_idx" ON "payroll_batches"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "payroll_batches_tenant_id_idempotency_key_key" ON "payroll_batches"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payroll_lines_payroll_batch_id_idx" ON "payroll_lines"("payroll_batch_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payroll_lines_employee_id_idx" ON "payroll_lines"("employee_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payroll_lines_technician_id_idx" ON "payroll_lines"("technician_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payroll_lines_earning_code_idx" ON "payroll_lines"("earning_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "payroll_lines_department_code_idx" ON "payroll_lines"("department_code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_published_at_idx" ON "outbox_events"("published_at");

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_batch_id_fkey" FOREIGN KEY ("payroll_batch_id") REFERENCES "payroll_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ====== auth-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read', 'write']::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");



-- ====== tenant-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dms_type" TEXT NOT NULL,
    "dms_api_key" TEXT NOT NULL,
    "schema_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROVISIONING',
    "rooftop_count" INTEGER NOT NULL DEFAULT 1,
    "webhook_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_schema_name_key" ON "tenants"("schema_name");



-- ====== eom-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "eom_closes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "current_step" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "blocked_reason" TEXT,

    CONSTRAINT "eom_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "eom_steps" (
    "id" TEXT NOT NULL,
    "eom_close_id" TEXT NOT NULL,
    "step_code" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "eom_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eom_closes_tenant_id_idx" ON "eom_closes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "eom_closes_tenant_id_period_year_period_month_key" ON "eom_closes"("tenant_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "eom_steps_eom_close_id_idx" ON "eom_steps"("eom_close_id");

-- AddForeignKey
ALTER TABLE "eom_steps" ADD CONSTRAINT "eom_steps_eom_close_id_fkey" FOREIGN KEY ("eom_close_id") REFERENCES "eom_closes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ====== apar-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "ar_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dealer_ref" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "oem_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ap_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "invoice_ref" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "gl_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ar_entries_tenant_id_idx" ON "ar_entries"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ar_entries_tenant_id_status_idx" ON "ar_entries"("tenant_id", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ap_entries_tenant_id_idx" ON "ap_entries"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ap_entries_tenant_id_status_idx" ON "ap_entries"("tenant_id", "status");



-- ====== cashflow-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "cashflow_forecasts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forecast_date" TIMESTAMP(3) NOT NULL,
    "predicted_balance" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "breakdown" JSONB NOT NULL,

    CONSTRAINT "cashflow_forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "daily_cash_actuals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "daily_cash_actuals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cashflow_forecasts_tenant_id_idx" ON "cashflow_forecasts"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "cashflow_forecasts_tenant_id_forecast_date_idx" ON "cashflow_forecasts"("tenant_id", "forecast_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "daily_cash_actuals_tenant_id_idx" ON "daily_cash_actuals"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "daily_cash_actuals_tenant_id_date_key" ON "daily_cash_actuals"("tenant_id", "date");



-- ====== recon-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "bank_recons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "recon_date" TIMESTAMP(3) NOT NULL,
    "gl_balance" DOUBLE PRECISION NOT NULL,
    "bank_balance" DOUBLE PRECISION NOT NULL,
    "variance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),

    CONSTRAINT "bank_recons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bank_transactions" (
    "id" TEXT NOT NULL,
    "bank_recon_id" TEXT NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "matched_journal_line_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bank_recons_tenant_id_idx" ON "bank_recons"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bank_transactions_bank_recon_id_idx" ON "bank_transactions"("bank_recon_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bank_transactions_bank_recon_id_status_idx" ON "bank_transactions"("bank_recon_id", "status");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_recon_id_fkey" FOREIGN KEY ("bank_recon_id") REFERENCES "bank_recons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ====== revenue-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "revenue_contracts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "total_value" DOUBLE PRECISION NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "recognition_method" TEXT NOT NULL DEFAULT 'STRAIGHT_LINE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "revenue_schedule_lines" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "scheduled_amount" DOUBLE PRECISION NOT NULL,
    "recognised_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "journal_entry_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "revenue_schedule_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "revenue_contracts_tenant_id_idx" ON "revenue_contracts"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "revenue_schedule_lines_contract_id_idx" ON "revenue_schedule_lines"("contract_id");

-- AddForeignKey
ALTER TABLE "revenue_schedule_lines" ADD CONSTRAINT "revenue_schedule_lines_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "revenue_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ====== group-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "dealer_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "dealer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "dealer_group_tenants" (
    "id" TEXT NOT NULL,
    "dealer_group_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rooftop_name" TEXT NOT NULL,

    CONSTRAINT "dealer_group_tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "dealer_group_tenants_dealer_group_id_idx" ON "dealer_group_tenants"("dealer_group_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_group_tenants_dealer_group_id_tenant_id_key" ON "dealer_group_tenants"("dealer_group_id", "tenant_id");

-- AddForeignKey
ALTER TABLE "dealer_group_tenants" ADD CONSTRAINT "dealer_group_tenants_dealer_group_id_fkey" FOREIGN KEY ("dealer_group_id") REFERENCES "dealer_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ====== webhook-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "webhook_registrations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target_url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_called_at" TIMESTAMP(3),
    "failure_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "webhook_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_registration_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 1,
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_registrations_tenant_id_idx" ON "webhook_registrations"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_registrations_is_active_idx" ON "webhook_registrations"("is_active");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_deliveries_webhook_registration_id_idx" ON "webhook_deliveries"("webhook_registration_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "webhook_deliveries_event_type_idx" ON "webhook_deliveries"("event_type");

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_registration_id_fkey" FOREIGN KEY ("webhook_registration_id") REFERENCES "webhook_registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ====== document-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "extracted_data" JSONB,
    "suggested_coding" JSONB,
    "vendor_name" TEXT,
    "invoice_number" TEXT,
    "invoice_date" TIMESTAMP(3),
    "total_amount" DOUBLE PRECISION,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_tenant_id_idx" ON "documents"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "documents_vendor_name_idx" ON "documents"("vendor_name");



-- ====== user-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "user_preferences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CONTROLLER',
    "dashboard_layout" JSONB NOT NULL DEFAULT '{}',
    "default_filters" JSONB NOT NULL DEFAULT '{}',
    "notifications" JSONB NOT NULL DEFAULT '{}',
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_preferences_tenant_id_idx" ON "user_preferences"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_preferences_tenant_id_user_id_key" ON "user_preferences"("tenant_id", "user_id");



-- ====== data-quality-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "data_quality_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "overall_score" DOUBLE PRECISION NOT NULL,
    "journal_line_score" DOUBLE PRECISION NOT NULL,
    "payroll_line_score" DOUBLE PRECISION NOT NULL,
    "deal_product_score" DOUBLE PRECISION NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "data_quality_reports_tenant_id_period_idx" ON "data_quality_reports"("tenant_id", "period");



-- ====== esg-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "esg_metrics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esg_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "esg_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "total_carbon_tons" DOUBLE PRECISION NOT NULL,
    "ev_revenue_pct" DOUBLE PRECISION NOT NULL,
    "ice_revenue_pct" DOUBLE PRECISION NOT NULL,
    "energy_kwh" DOUBLE PRECISION NOT NULL,
    "sustainability_score" DOUBLE PRECISION NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esg_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "esg_metrics_tenant_id_period_idx" ON "esg_metrics"("tenant_id", "period");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "esg_reports_tenant_id_period_idx" ON "esg_reports"("tenant_id", "period");



-- ====== analytics-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "agg_monthly_pl" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "department_code" TEXT NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cost_of_sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gross_profit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expenses" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "net_income" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "agg_monthly_pl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agg_tech_productivity" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "technician_id" TEXT NOT NULL,
    "total_flat_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_clock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "efficiency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_labour_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ro_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "agg_tech_productivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agg_parts_margin" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "total_sold" INTEGER NOT NULL DEFAULT 0,
    "total_revenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_cost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gross_margin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gross_margin_pct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "agg_parts_margin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agg_monthly_pl_tenant_id_period_department_code_key" ON "agg_monthly_pl"("tenant_id", "period", "department_code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agg_tech_productivity_tenant_id_period_technician_id_key" ON "agg_tech_productivity"("tenant_id", "period", "technician_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agg_parts_margin_tenant_id_period_part_number_key" ON "agg_parts_margin"("tenant_id", "period", "part_number");



-- ====== ml-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "ml_models" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "model_type" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0',
    "trained_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ml_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ml_predictions" (
    "id" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "prediction" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "actual_outcome" TEXT,
    "was_correct" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ml_predictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ml_models_tenant_id_model_type_idx" ON "ml_models"("tenant_id", "model_type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ml_predictions_tenant_id_idx" ON "ml_predictions"("tenant_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ml_predictions_model_id_idx" ON "ml_predictions"("model_id");



-- ====== query-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "saved_queries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "prisma_query" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_run_at" TIMESTAMP(3),

    CONSTRAINT "saved_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "query_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "prisma_query" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "query_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "saved_queries_tenant_id_user_id_idx" ON "saved_queries"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "query_history_tenant_id_user_id_idx" ON "query_history"("tenant_id", "user_id");



-- ====== orchestrator-service ======
-- CreateTable
CREATE TABLE IF NOT EXISTS "OrchestrationTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workflowType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "totalSteps" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "startedBy" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrchestrationTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrchestrationTask_tenantId_workflowType_idx" ON "OrchestrationTask"("tenantId", "workflowType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrchestrationTask_status_idx" ON "OrchestrationTask"("status");






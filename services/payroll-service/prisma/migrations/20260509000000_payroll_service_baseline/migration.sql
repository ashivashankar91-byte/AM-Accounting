-- payroll-service baseline schema.
--
-- Migration-orchestration fix (STABILIZE THE CONSOLIDATED ACCOUNTING
-- APPLICATION): payroll-service's prisma/migrations/ previously contained
-- only one legacy flat .sql file (20260509_phase1_commission_plans.sql)
-- sitting directly in the migrations/ directory rather than Prisma's
-- required folder-per-migration format (migrations/<timestamp>_<name>/
-- migration.sql), and had no migration_lock.toml. `prisma migrate deploy`
-- silently reported "No migration found in prisma/migrations" for this
-- reason -- none of payroll-service's core tables (employees,
-- payroll_batches, payroll_items, payroll_gl_mappings, payroll_tax_rates,
-- employee_ytd) were ever actually created by any migration tooling; the
-- one flat file's 2 tables (commission_plans, commission_records) were
-- themselves never applied either. This single baseline, generated via
-- `prisma migrate diff --from-empty --to-schema-datamodel
-- prisma/schema.prisma --script` against the current schema.prisma,
-- supersedes the flat file's net effect and creates payroll-service's
-- complete table set. Additive schema creation only -- no data existed
-- to migrate.
--
-- outbox_events is deliberately created with IF NOT EXISTS / its indexes
-- with IF NOT EXISTS: this table name (no service prefix) is intentionally
-- shared across six services' own OutboxEvent Prisma models mapping to the
-- same physical table (apar-service, eom-service, group-service,
-- gl-service, payroll-service, schedule-service) -- whichever service's
-- migration runs first legitimately creates it; this must not fail if
-- another service already has. Same defensive pattern used by
-- eom-service's baseline (20260508000000_eom_service_baseline) and
-- gl-service's 20260506000000_init_gl_service.

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "pay_type" TEXT NOT NULL,
    "pay_rate" DECIMAL(15,4),
    "commission_rate" DECIMAL(5,4),
    "pay_frequency" TEXT NOT NULL DEFAULT 'BI_WEEKLY',
    "federal_filing_status" TEXT NOT NULL DEFAULT 'SINGLE',
    "state_code" TEXT,
    "federal_allowances" INTEGER NOT NULL DEFAULT 0,
    "state_allowances" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hire_date" TIMESTAMP(3) NOT NULL,
    "termination_date" TIMESTAMP(3),
    "default_gl_dept" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "pay_period_start" TIMESTAMP(3) NOT NULL,
    "pay_period_end" TIMESTAMP(3) NOT NULL,
    "pay_date" TIMESTAMP(3) NOT NULL,
    "pay_frequency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "total_gross_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_net_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_employer_tax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "journal_entry_id" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "regular_hours" DECIMAL(8,2),
    "overtime_hours" DECIMAL(8,2),
    "regular_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "overtime_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "commission_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "bonus_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "other_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "gross_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "federal_tax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "state_tax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "social_security" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "medicare" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employer_fica" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employer_medicare" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employer_futa" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employer_suta" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_employer_tax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "gl_account_code" TEXT,
    "gl_department" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_gl_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "pay_component" TEXT NOT NULL,
    "gl_account_code" TEXT NOT NULL,
    "is_debit" BOOLEAN NOT NULL,

    CONSTRAINT "payroll_gl_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_tax_rates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tax_type" TEXT NOT NULL,
    "rate" DECIMAL(7,6) NOT NULL,
    "wage_base" DECIMAL(15,2),
    "effective_year" INTEGER NOT NULL,
    "is_employer" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payroll_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_ytd" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "gross_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "federal_tax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "state_tax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "social_security" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "medicare" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "fica_wages" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "employee_ytd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "outbox_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "plan_type" VARCHAR(20) NOT NULL,
    "department" TEXT,
    "flat_amount" DECIMAL(15,2),
    "percentage_rate" DECIMAL(5,2),
    "tiers" JSONB,
    "effective_date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "deal_type" VARCHAR(20),
    "gross_profit" DECIMAL(15,2) NOT NULL,
    "commission_amount" DECIMAL(15,2) NOT NULL,
    "plan_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACCRUED',
    "journal_entry_id" TEXT,
    "period_year" INTEGER,
    "period_month" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "commission_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employees_tenant_id_department_is_active_idx" ON "employees"("tenant_id", "department", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");

-- CreateIndex
CREATE INDEX "payroll_batches_tenant_id_status_idx" ON "payroll_batches"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "payroll_batches_tenant_id_pay_date_idx" ON "payroll_batches"("tenant_id", "pay_date");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_batches_tenant_id_batch_number_key" ON "payroll_batches"("tenant_id", "batch_number");

-- CreateIndex
CREATE INDEX "payroll_items_tenant_id_batch_id_idx" ON "payroll_items"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "payroll_items_tenant_id_employee_id_idx" ON "payroll_items"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "payroll_gl_mappings_tenant_id_idx" ON "payroll_gl_mappings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_gl_mappings_tenant_id_department_pay_component_key" ON "payroll_gl_mappings"("tenant_id", "department", "pay_component");

-- CreateIndex
CREATE INDEX "payroll_tax_rates_tenant_id_effective_year_idx" ON "payroll_tax_rates"("tenant_id", "effective_year");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_tax_rates_tenant_id_tax_type_effective_year_is_empl_key" ON "payroll_tax_rates"("tenant_id", "tax_type", "effective_year", "is_employer");

-- CreateIndex
CREATE INDEX "employee_ytd_tenant_id_year_idx" ON "employee_ytd"("tenant_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "employee_ytd_tenant_id_employee_id_year_key" ON "employee_ytd"("tenant_id", "employee_id", "year");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_published_at_retry_count_idx" ON "outbox_events"("published_at", "retry_count");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "outbox_events_created_at_idx" ON "outbox_events"("created_at");

-- CreateIndex
CREATE INDEX "commission_plans_tenant_id_idx" ON "commission_plans"("tenant_id");

-- CreateIndex
CREATE INDEX "commission_plans_tenant_id_employee_id_idx" ON "commission_plans"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "commission_plans_tenant_id_is_active_idx" ON "commission_plans"("tenant_id", "is_active");

-- CreateIndex
CREATE INDEX "commission_records_tenant_id_idx" ON "commission_records"("tenant_id");

-- CreateIndex
CREATE INDEX "commission_records_tenant_id_employee_id_idx" ON "commission_records"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "commission_records_tenant_id_period_year_period_month_idx" ON "commission_records"("tenant_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "commission_records_tenant_id_status_idx" ON "commission_records"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "payroll_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_ytd" ADD CONSTRAINT "employee_ytd_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "commission_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

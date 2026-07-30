-- fs-service baseline schema.
--
-- Migration-orchestration fix (STABILIZE THE CONSOLIDATED ACCOUNTING
-- APPLICATION): fs-service's prisma/migrations/ previously contained only
-- one legacy flat .sql file (20260507_build011_format_template_setup.sql)
-- sitting directly in the migrations/ directory rather than Prisma's
-- required folder-per-migration format (migrations/<timestamp>_<name>/
-- migration.sql), and had no migration_lock.toml. `prisma migrate deploy`
-- silently reported "No migration found in prisma/migrations" for this
-- reason -- none of fs-service's tables (financial_statements,
-- fs_line_items, fs_comparisons, fs_supplemental_data, oem_profiles,
-- oem_account_mappings, format_codes, fs_templates, fs_setup) were ever
-- actually created by any migration tooling; the one flat file's 3 tables
-- (format_codes, fs_templates, fs_setup) were themselves never applied
-- either. This single baseline, generated via `prisma migrate diff
-- --from-empty --to-schema-datamodel prisma/schema.prisma --script`
-- against the current schema.prisma, supersedes the flat file's net
-- effect and creates fs-service's complete table set. Additive schema
-- creation only -- no data existed to migrate.

-- CreateTable
CREATE TABLE "oem_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "oem_code" TEXT NOT NULL,
    "oem_name" TEXT NOT NULL,
    "dealer_code" TEXT NOT NULL,
    "report_format" TEXT NOT NULL DEFAULT 'STANDARD',
    "submission_method" TEXT NOT NULL DEFAULT 'API',
    "submission_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oem_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_account_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "oem_profile_id" TEXT NOT NULL,
    "oem_line_number" TEXT NOT NULL,
    "oem_line_label" TEXT NOT NULL,
    "oem_section" TEXT NOT NULL,
    "gl_account_codes" TEXT[],
    "calculation_type" TEXT NOT NULL DEFAULT 'SUM',
    "formula" TEXT,
    "display_order" INTEGER NOT NULL,
    "is_subtotal" BOOLEAN NOT NULL DEFAULT false,
    "is_total" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "oem_account_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_statements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "oem_profile_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "statement_type" TEXT NOT NULL DEFAULT 'MONTHLY',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generated_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,
    "response_code" TEXT,
    "response_message" TEXT,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fs_line_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "oem_line_number" TEXT NOT NULL,
    "oem_line_label" TEXT NOT NULL,
    "oem_section" TEXT NOT NULL,
    "current_month" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "year_to_date" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "prior_month" DECIMAL(15,2),
    "prior_year" DECIMAL(15,2),
    "variance" DECIMAL(15,2),
    "variance_pct" DECIMAL(8,4),
    "display_order" INTEGER NOT NULL,
    "is_subtotal" BOOLEAN NOT NULL DEFAULT false,
    "is_total" BOOLEAN NOT NULL DEFAULT false,
    "gl_account_codes" TEXT[],

    CONSTRAINT "fs_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fs_comparisons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "comparison_type" TEXT NOT NULL,
    "comparison_year" INTEGER NOT NULL,
    "comparison_month" INTEGER NOT NULL,

    CONSTRAINT "fs_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fs_supplemental_data" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "oem_code" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_value" TEXT NOT NULL,
    "field_type" TEXT NOT NULL DEFAULT 'STRING',

    CONSTRAINT "fs_supplemental_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "format_codes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "mfg_code" TEXT NOT NULL,
    "format_name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "format_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fs_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "mfg_code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fs_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fs_setup" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "mfg_code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "calendar_or_fiscal" TEXT NOT NULL DEFAULT 'FISCAL',
    "statement_option" TEXT,
    "transmission_group" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fs_setup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oem_profiles_tenant_id_is_active_idx" ON "oem_profiles"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "oem_profiles_tenant_id_oem_code_key" ON "oem_profiles"("tenant_id", "oem_code");

-- CreateIndex
CREATE INDEX "oem_account_mappings_tenant_id_oem_profile_id_display_order_idx" ON "oem_account_mappings"("tenant_id", "oem_profile_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "oem_account_mappings_tenant_id_oem_profile_id_oem_line_numb_key" ON "oem_account_mappings"("tenant_id", "oem_profile_id", "oem_line_number");

-- CreateIndex
CREATE INDEX "financial_statements_tenant_id_status_idx" ON "financial_statements"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "financial_statements_tenant_id_oem_profile_id_period_year_p_key" ON "financial_statements"("tenant_id", "oem_profile_id", "period_year", "period_month", "statement_type");

-- CreateIndex
CREATE INDEX "fs_line_items_tenant_id_statement_id_display_order_idx" ON "fs_line_items"("tenant_id", "statement_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "fs_comparisons_tenant_id_statement_id_comparison_type_key" ON "fs_comparisons"("tenant_id", "statement_id", "comparison_type");

-- CreateIndex
CREATE INDEX "fs_supplemental_data_tenant_id_oem_code_period_year_period__idx" ON "fs_supplemental_data"("tenant_id", "oem_code", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "fs_supplemental_data_tenant_id_oem_code_period_year_period__key" ON "fs_supplemental_data"("tenant_id", "oem_code", "period_year", "period_month", "field_name");

-- CreateIndex
CREATE INDEX "format_codes_tenant_id_is_active_idx" ON "format_codes"("tenant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "format_codes_tenant_id_mfg_code_key" ON "format_codes"("tenant_id", "mfg_code");

-- CreateIndex
CREATE INDEX "fs_templates_tenant_id_mfg_code_idx" ON "fs_templates"("tenant_id", "mfg_code");

-- CreateIndex
CREATE UNIQUE INDEX "fs_templates_tenant_id_mfg_code_year_key" ON "fs_templates"("tenant_id", "mfg_code", "year");

-- CreateIndex
CREATE INDEX "fs_setup_tenant_id_mfg_code_idx" ON "fs_setup"("tenant_id", "mfg_code");

-- CreateIndex
CREATE UNIQUE INDEX "fs_setup_tenant_id_mfg_code_year_key" ON "fs_setup"("tenant_id", "mfg_code", "year");

-- AddForeignKey
ALTER TABLE "oem_account_mappings" ADD CONSTRAINT "oem_account_mappings_oem_profile_id_fkey" FOREIGN KEY ("oem_profile_id") REFERENCES "oem_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statements" ADD CONSTRAINT "financial_statements_oem_profile_id_fkey" FOREIGN KEY ("oem_profile_id") REFERENCES "oem_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fs_line_items" ADD CONSTRAINT "fs_line_items_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "financial_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fs_comparisons" ADD CONSTRAINT "fs_comparisons_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "financial_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

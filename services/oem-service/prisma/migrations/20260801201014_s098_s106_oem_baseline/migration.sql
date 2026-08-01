-- CreateEnum
CREATE TYPE "OemConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'TEST_ONLY', 'CERTIFICATION_PENDING', 'CERTIFIED');

-- CreateEnum
CREATE TYPE "OemStagedSourceType" AS ENUM ('FEED', 'MANUAL');

-- CreateEnum
CREATE TYPE "OemStagedDocumentKind" AS ENUM ('REMITTANCE', 'CHARGEBACK_NOTICE', 'INCENTIVE_STATEMENT', 'PARTS_RETURN_CREDIT', 'COOP_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "OemRowParseStatus" AS ENUM ('PARSED', 'UNPARSED');

-- CreateEnum
CREATE TYPE "OemOpenItemType" AS ENUM ('WARRANTY_CLAIM', 'PARTS_RETURN_CREDIT', 'INCENTIVE_ACCRUAL', 'COOP_CLAIM');

-- CreateEnum
CREATE TYPE "OemMatchDisposition" AS ENUM ('PENDING', 'MATCHED', 'SHORT_PAID', 'DISPUTED', 'INVESTIGATION');

-- CreateEnum
CREATE TYPE "OemMatchSessionStatus" AS ENUM ('OPEN', 'COMPLETE');

-- CreateEnum
CREATE TYPE "OemIncentiveAmountType" AS ENUM ('FLAT', 'TABLE');

-- CreateEnum
CREATE TYPE "OemIncentiveAccrualStatus" AS ENUM ('ACCRUED', 'TRUED_UP');

-- CreateEnum
CREATE TYPE "OemStatementMappingStatus" AS ENUM ('DRAFT', 'ACTIVE');

-- CreateEnum
CREATE TYPE "OemChargebackDisposition" AS ENUM ('PENDING', 'ACCEPTED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "OemReserveEntryStatus" AS ENUM ('PREVIEW', 'APPROVED', 'POSTED');

-- CreateEnum
CREATE TYPE "OemCoopClaimStatus" AS ENUM ('DRAFT', 'EXPORTED', 'RESPONSE_RECORDED');

-- CreateEnum
CREATE TYPE "OemCoopLineResponseStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "OemCoopAccrualStatus" AS ENUM ('PREVIEW', 'APPROVED', 'TRUED_UP');

-- CreateEnum
CREATE TYPE "OemCoopAccrualBasis" AS ENUM ('PERCENT_OF_SALES', 'ENTERED_TERMS');

-- CreateTable
CREATE TABLE "oem_integration_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "make" VARCHAR(40) NOT NULL,
    "program_name" VARCHAR(120),
    "connection_status" "OemConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "statement_spec_version" VARCHAR(40),
    "certification_evidence_ref" VARCHAR(200),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oem_integration_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_dealer_codes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "dealer_code" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_dealer_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_staged_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "profile_id" TEXT NOT NULL,
    "make" VARCHAR(40) NOT NULL,
    "source_type" "OemStagedSourceType" NOT NULL,
    "kind" "OemStagedDocumentKind" NOT NULL,
    "document_identity" VARCHAR(200) NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "spec_version" VARCHAR(40),
    "raw_content" TEXT NOT NULL,
    "supersedes_document_id" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imported_by" TEXT NOT NULL,

    CONSTRAINT "oem_staged_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_staged_document_rows" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "parse_status" "OemRowParseStatus" NOT NULL,
    "canonical_type" VARCHAR(40),
    "fields" JSONB NOT NULL,
    "raw_line" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_staged_document_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_diff_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "prior_document_id" TEXT NOT NULL,
    "new_document_id" TEXT NOT NULL,
    "field_diffs" JSONB NOT NULL,
    "raised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,

    CONSTRAINT "oem_diff_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_match_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "statement_document_id" TEXT NOT NULL,
    "status" "OemMatchSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_by" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,

    CONSTRAINT "oem_match_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_match_session_rows" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "staged_row_id" TEXT,
    "is_system_generated" BOOLEAN NOT NULL DEFAULT false,
    "open_item_ref" TEXT,
    "open_item_type" "OemOpenItemType",
    "disposition" "OemMatchDisposition" NOT NULL DEFAULT 'PENDING',
    "statement_amount" DECIMAL(15,2) NOT NULL,
    "applied_amount" DECIMAL(15,2),
    "write_down_amount" DECIMAL(15,2),
    "apply_number" VARCHAR(40),
    "note" TEXT,
    "dispositioned_at" TIMESTAMP(3),
    "dispositioned_by" TEXT,

    CONSTRAINT "oem_match_session_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_incentive_programs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "make" VARCHAR(40) NOT NULL,
    "program_id" VARCHAR(60) NOT NULL,
    "termsSummary" TEXT,
    "amount_type" "OemIncentiveAmountType" NOT NULL,
    "flat_amount_per_unit" DECIMAL(15,2),
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_incentive_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_incentive_accruals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "deal_number" VARCHAR(40) NOT NULL,
    "apply_number" VARCHAR(60) NOT NULL,
    "accrued_amount" DECIMAL(15,2) NOT NULL,
    "status" "OemIncentiveAccrualStatus" NOT NULL DEFAULT 'ACCRUED',
    "source_deal_finalized_ref" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_incentive_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_incentive_true_ups" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "accrual_id" TEXT NOT NULL,
    "statement_row_ref" TEXT,
    "adjustment_amount" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "oem_incentive_true_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_statement_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "profile_ref_id" TEXT NOT NULL,
    "make" VARCHAR(40) NOT NULL,
    "version" VARCHAR(40) NOT NULL,
    "page_line_definitions" JSONB NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_statement_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_statement_account_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "statement_profile_id" TEXT NOT NULL,
    "gl_account_id" VARCHAR(40) NOT NULL,
    "statement_line_ref" VARCHAR(60) NOT NULL,
    "status" "OemStatementMappingStatus" NOT NULL DEFAULT 'DRAFT',
    "authored_by" TEXT NOT NULL,
    "authored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_by" TEXT,
    "activated_at" TIMESTAMP(3),

    CONSTRAINT "oem_statement_account_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_statement_renders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "statement_profile_id" TEXT NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "cell_values" JSONB NOT NULL,
    "cross_foot_ok" BOOLEAN NOT NULL,
    "tb_tie_ok" BOOLEAN NOT NULL,
    "variance_amount" DECIMAL(15,2),
    "rendered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rendered_by" TEXT NOT NULL,

    CONSTRAINT "oem_statement_renders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_statement_exports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "render_id" TEXT NOT NULL,
    "spec_version" VARCHAR(40) NOT NULL,
    "format" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "exported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exported_by" TEXT NOT NULL,
    "retained" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "oem_statement_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_warranty_chargeback_notices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "make" VARCHAR(40) NOT NULL,
    "source_document_id" TEXT,
    "notice_date" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_by" TEXT NOT NULL,

    CONSTRAINT "oem_warranty_chargeback_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_warranty_chargeback_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "original_claim_item_ref" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "disposition" "OemChargebackDisposition" NOT NULL DEFAULT 'PENDING',
    "contra_item_ref" TEXT,
    "dispositioned_at" TIMESTAMP(3),
    "dispositioned_by" TEXT,

    CONSTRAINT "oem_warranty_chargeback_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_warranty_dispute_evidence" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "chargeback_line_id" TEXT NOT NULL,
    "evidence_ref" TEXT NOT NULL,
    "note" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT NOT NULL,

    CONSTRAINT "oem_warranty_dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_warranty_reserve_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "oem_warranty_reserve_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_warranty_reserve_previews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "paid_warranty_volume" DECIMAL(15,2) NOT NULL,
    "computed_accrual" DECIMAL(15,2) NOT NULL,
    "status" "OemReserveEntryStatus" NOT NULL DEFAULT 'PREVIEW',
    "previewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,

    CONSTRAINT "oem_warranty_reserve_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_warranty_reserve_draws" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "chargeback_line_id" TEXT NOT NULL,
    "draw_amount" DECIMAL(15,2) NOT NULL,
    "excess_to_expense" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "drawn_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drawn_by" TEXT NOT NULL,

    CONSTRAINT "oem_warranty_reserve_draws_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_coop_programs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "make" VARCHAR(40) NOT NULL,
    "program_id" VARCHAR(60) NOT NULL,
    "accrual_basis" "OemCoopAccrualBasis" NOT NULL,
    "rate_percent" DECIMAL(7,4),
    "termsSummary" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_coop_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_coop_claims" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "status" "OemCoopClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "total_spend" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "exported_at" TIMESTAMP(3),
    "exported_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "oem_coop_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_coop_claim_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "spend_item_ref" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "evidence_ref" TEXT NOT NULL,
    "response_status" "OemCoopLineResponseStatus" NOT NULL DEFAULT 'PENDING',
    "approved_amount" DECIMAL(15,2),
    "receivable_item_ref" TEXT,
    "write_off_amount" DECIMAL(15,2),
    "responded_at" TIMESTAMP(3),
    "responded_by" TEXT,

    CONSTRAINT "oem_coop_claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_coop_accrual_previews" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "computed_amount" DECIMAL(15,2) NOT NULL,
    "status" "OemCoopAccrualStatus" NOT NULL DEFAULT 'PREVIEW',
    "previewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,

    CONSTRAINT "oem_coop_accrual_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_idempotency_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "operation_type" VARCHAR(60) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "result_ref" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- audit_outbox is intentionally NOT created here: it is a table shared
-- physically across every service (see migration
-- 20260801201016_add_audit_outbox_oem_svc's header for the full
-- rationale), created there via CREATE TABLE IF NOT EXISTS so it is safe
-- regardless of which service's migration runs first in a given
-- environment. Prisma's schema-diff migration generator does not know
-- about that convention and would otherwise emit a plain (non-idempotent)
-- CREATE TABLE here — confirmed to break scripts/migrate-all.sh against a
-- fresh database when an earlier service already created the table, fixed
-- by dropping the generated statement from this baseline and keeping only
-- the hand-authored idempotent migration.

-- CreateIndex
CREATE INDEX "oem_integration_profiles_tenant_id_idx" ON "oem_integration_profiles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_integration_profiles_tenant_id_make_key" ON "oem_integration_profiles"("tenant_id", "make");

-- CreateIndex
CREATE INDEX "oem_dealer_codes_tenant_id_idx" ON "oem_dealer_codes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_dealer_codes_tenant_id_profile_id_store_id_key" ON "oem_dealer_codes"("tenant_id", "profile_id", "store_id");

-- CreateIndex
CREATE INDEX "oem_staged_documents_tenant_id_profile_id_idx" ON "oem_staged_documents"("tenant_id", "profile_id");

-- CreateIndex
CREATE INDEX "oem_staged_documents_tenant_id_document_identity_imported_a_idx" ON "oem_staged_documents"("tenant_id", "document_identity", "imported_at");

-- CreateIndex
CREATE INDEX "oem_staged_document_rows_tenant_id_document_id_idx" ON "oem_staged_document_rows"("tenant_id", "document_id");

-- CreateIndex
CREATE INDEX "oem_diff_alerts_tenant_id_profile_id_idx" ON "oem_diff_alerts"("tenant_id", "profile_id");

-- CreateIndex
CREATE INDEX "oem_match_sessions_tenant_id_store_id_idx" ON "oem_match_sessions"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "oem_match_session_rows_tenant_id_session_id_idx" ON "oem_match_session_rows"("tenant_id", "session_id");

-- CreateIndex
CREATE INDEX "oem_incentive_programs_tenant_id_idx" ON "oem_incentive_programs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_incentive_programs_tenant_id_make_program_id_key" ON "oem_incentive_programs"("tenant_id", "make", "program_id");

-- CreateIndex
CREATE INDEX "oem_incentive_accruals_tenant_id_store_id_idx" ON "oem_incentive_accruals"("tenant_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_incentive_accruals_tenant_id_program_id_deal_number_key" ON "oem_incentive_accruals"("tenant_id", "program_id", "deal_number");

-- CreateIndex
CREATE INDEX "oem_incentive_true_ups_tenant_id_accrual_id_idx" ON "oem_incentive_true_ups"("tenant_id", "accrual_id");

-- CreateIndex
CREATE INDEX "oem_statement_profiles_tenant_id_idx" ON "oem_statement_profiles"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_statement_profiles_tenant_id_make_version_key" ON "oem_statement_profiles"("tenant_id", "make", "version");

-- CreateIndex
CREATE INDEX "oem_statement_account_mappings_tenant_id_statement_profile__idx" ON "oem_statement_account_mappings"("tenant_id", "statement_profile_id");

-- CreateIndex
CREATE INDEX "oem_statement_renders_tenant_id_store_id_period_idx" ON "oem_statement_renders"("tenant_id", "store_id", "period");

-- CreateIndex
CREATE INDEX "oem_statement_exports_tenant_id_render_id_idx" ON "oem_statement_exports"("tenant_id", "render_id");

-- CreateIndex
CREATE INDEX "oem_warranty_chargeback_notices_tenant_id_store_id_idx" ON "oem_warranty_chargeback_notices"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "oem_warranty_chargeback_lines_tenant_id_notice_id_idx" ON "oem_warranty_chargeback_lines"("tenant_id", "notice_id");

-- CreateIndex
CREATE INDEX "oem_warranty_dispute_evidence_tenant_id_chargeback_line_id_idx" ON "oem_warranty_dispute_evidence"("tenant_id", "chargeback_line_id");

-- CreateIndex
CREATE INDEX "oem_warranty_reserve_configs_tenant_id_store_id_idx" ON "oem_warranty_reserve_configs"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "oem_warranty_reserve_previews_tenant_id_store_id_idx" ON "oem_warranty_reserve_previews"("tenant_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_warranty_reserve_previews_tenant_id_store_id_period_key" ON "oem_warranty_reserve_previews"("tenant_id", "store_id", "period");

-- CreateIndex
CREATE INDEX "oem_warranty_reserve_draws_tenant_id_store_id_idx" ON "oem_warranty_reserve_draws"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "oem_coop_programs_tenant_id_idx" ON "oem_coop_programs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_coop_programs_tenant_id_make_program_id_key" ON "oem_coop_programs"("tenant_id", "make", "program_id");

-- CreateIndex
CREATE INDEX "oem_coop_claims_tenant_id_store_id_idx" ON "oem_coop_claims"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "oem_coop_claim_lines_tenant_id_claim_id_idx" ON "oem_coop_claim_lines"("tenant_id", "claim_id");

-- CreateIndex
CREATE INDEX "oem_coop_accrual_previews_tenant_id_store_id_idx" ON "oem_coop_accrual_previews"("tenant_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_coop_accrual_previews_tenant_id_store_id_program_id_per_key" ON "oem_coop_accrual_previews"("tenant_id", "store_id", "program_id", "period");

-- CreateIndex
CREATE INDEX "oem_idempotency_records_tenant_id_idx" ON "oem_idempotency_records"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "oem_idempotency_records_tenant_id_operation_type_idempotenc_key" ON "oem_idempotency_records"("tenant_id", "operation_type", "idempotency_key");

-- audit_outbox's index is created by migration 20260801201016_add_audit_outbox_oem_svc (see note above).

-- AddForeignKey
ALTER TABLE "oem_dealer_codes" ADD CONSTRAINT "oem_dealer_codes_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "oem_integration_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_staged_documents" ADD CONSTRAINT "oem_staged_documents_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "oem_integration_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_staged_document_rows" ADD CONSTRAINT "oem_staged_document_rows_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "oem_staged_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_diff_alerts" ADD CONSTRAINT "oem_diff_alerts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "oem_integration_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_diff_alerts" ADD CONSTRAINT "oem_diff_alerts_prior_document_id_fkey" FOREIGN KEY ("prior_document_id") REFERENCES "oem_staged_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_diff_alerts" ADD CONSTRAINT "oem_diff_alerts_new_document_id_fkey" FOREIGN KEY ("new_document_id") REFERENCES "oem_staged_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_match_sessions" ADD CONSTRAINT "oem_match_sessions_statement_document_id_fkey" FOREIGN KEY ("statement_document_id") REFERENCES "oem_staged_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_match_session_rows" ADD CONSTRAINT "oem_match_session_rows_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "oem_match_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_match_session_rows" ADD CONSTRAINT "oem_match_session_rows_staged_row_id_fkey" FOREIGN KEY ("staged_row_id") REFERENCES "oem_staged_document_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_incentive_programs" ADD CONSTRAINT "oem_incentive_programs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "oem_integration_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_incentive_accruals" ADD CONSTRAINT "oem_incentive_accruals_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "oem_incentive_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_incentive_true_ups" ADD CONSTRAINT "oem_incentive_true_ups_accrual_id_fkey" FOREIGN KEY ("accrual_id") REFERENCES "oem_incentive_accruals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_statement_profiles" ADD CONSTRAINT "oem_statement_profiles_profile_ref_id_fkey" FOREIGN KEY ("profile_ref_id") REFERENCES "oem_integration_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_statement_account_mappings" ADD CONSTRAINT "oem_statement_account_mappings_statement_profile_id_fkey" FOREIGN KEY ("statement_profile_id") REFERENCES "oem_statement_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_statement_renders" ADD CONSTRAINT "oem_statement_renders_statement_profile_id_fkey" FOREIGN KEY ("statement_profile_id") REFERENCES "oem_statement_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_statement_exports" ADD CONSTRAINT "oem_statement_exports_render_id_fkey" FOREIGN KEY ("render_id") REFERENCES "oem_statement_renders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_warranty_chargeback_notices" ADD CONSTRAINT "oem_warranty_chargeback_notices_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "oem_staged_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_warranty_chargeback_lines" ADD CONSTRAINT "oem_warranty_chargeback_lines_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "oem_warranty_chargeback_notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_warranty_dispute_evidence" ADD CONSTRAINT "oem_warranty_dispute_evidence_chargeback_line_id_fkey" FOREIGN KEY ("chargeback_line_id") REFERENCES "oem_warranty_chargeback_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_warranty_reserve_draws" ADD CONSTRAINT "oem_warranty_reserve_draws_chargeback_line_id_fkey" FOREIGN KEY ("chargeback_line_id") REFERENCES "oem_warranty_chargeback_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_coop_programs" ADD CONSTRAINT "oem_coop_programs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "oem_integration_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_coop_claims" ADD CONSTRAINT "oem_coop_claims_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "oem_coop_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_coop_claim_lines" ADD CONSTRAINT "oem_coop_claim_lines_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "oem_coop_claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_coop_accrual_previews" ADD CONSTRAINT "oem_coop_accrual_previews_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "oem_coop_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "lender_program_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lender_program_code" TEXT NOT NULL,
    "lender_program_name" TEXT NOT NULL,
    "chargeback_reserve_percent" DECIMAL(5,2) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lender_program_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_program_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_code" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "pro_rata_table" JSONB NOT NULL,
    "term_months" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_program_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferral_mode_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "earning_pattern_type" TEXT NOT NULL,
    "earning_pattern_months" INTEGER,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deferral_mode_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fni_schedule_mapping" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "schedule_number" CHAR(2) NOT NULL,
    "gl_account_number" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fni_schedule_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserve_remittance" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "lender_program_code" TEXT NOT NULL,
    "expected_amount" DECIMAL(15,2) NOT NULL,
    "remitted_amount" DECIMAL(15,2) NOT NULL,
    "short_pay_amount" DECIMAL(15,2) NOT NULL,
    "cash_origination_linkage_status" TEXT NOT NULL DEFAULT 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
    "idempotency_key" TEXT NOT NULL,
    "posting_execution_id" TEXT,
    "accrual_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserve_remittance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remittance_shortpay_disposition" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "remittance_id" TEXT NOT NULL,
    "disposition_type" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "posting_execution_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remittance_shortpay_disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chargeback_reserve_accrual" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "lender_program_code" TEXT NOT NULL,
    "reserve_income_amount" DECIMAL(15,2) NOT NULL,
    "accrual_percent" DECIMAL(5,2) NOT NULL,
    "accrual_amount" DECIMAL(15,2) NOT NULL,
    "control_number" TEXT NOT NULL,
    "posting_execution_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chargeback_reserve_accrual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chargeback_draw" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "lender_program_code" TEXT NOT NULL,
    "control_number" TEXT NOT NULL,
    "chargeback_amount" DECIMAL(15,2) NOT NULL,
    "draw_from_reserve_amount" DECIMAL(15,2) NOT NULL,
    "excess_to_expense_amount" DECIMAL(15,2) NOT NULL,
    "reserve_balance_before" DECIMAL(15,2) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_cancellation_id" TEXT,
    "posting_execution_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chargeback_draw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remit_liability_tracking" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "provider_code" TEXT NOT NULL,
    "gl_account_number" TEXT NOT NULL,
    "schedule_number" TEXT NOT NULL,
    "schedule_open_item_id" TEXT,
    "original_amount" DECIMAL(15,2) NOT NULL,
    "remaining_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remit_liability_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_remit_run" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_code" TEXT NOT NULL,
    "run_date" TIMESTAMP(3) NOT NULL,
    "total_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'EXECUTED',
    "payment_rail_linkage_status" TEXT NOT NULL DEFAULT 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_remit_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_remit_run_item" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "apply_control_number" TEXT NOT NULL,
    "posting_execution_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RELIEVED',

    CONSTRAINT "product_remit_run_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_statement_reconciliation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider_code" TEXT NOT NULL,
    "statement_date" TIMESTAMP(3) NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_statement_reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_statement_line" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "reconciliation_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "statement_amount" DECIMAL(15,2) NOT NULL,
    "our_remitted_amount" DECIMAL(15,2) NOT NULL,
    "variance" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'MATCHED',
    "reviewed_by" TEXT,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "provider_statement_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_cancellation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "cancellation_source" TEXT NOT NULL,
    "refund_basis" TEXT NOT NULL,
    "quote_total" DECIMAL(15,2) NOT NULL,
    "income_reversal_amount" DECIMAL(15,2) NOT NULL,
    "remit_adjustment_amount" DECIMAL(15,2) NOT NULL,
    "refund_payable_amount" DECIMAL(15,2) NOT NULL,
    "refund_payable_linkage_status" TEXT NOT NULL DEFAULT 'PENDING_UPSTREAM_TECHNICAL_RECONCILIATION',
    "chargeback_triggered" BOOLEAN NOT NULL DEFAULT false,
    "chargeback_draw_id" TEXT,
    "posting_execution_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferral_booking" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "product_code" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "original_amount" DECIMAL(15,2) NOT NULL,
    "recognized_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "booking_date" TIMESTAMP(3) NOT NULL,
    "deferral_mode_config_id" TEXT,
    "earning_pattern_type" TEXT NOT NULL,
    "earning_pattern_months" INTEGER,
    "control_number" TEXT NOT NULL,
    "gl_account_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "idempotency_key" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deferral_booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recognition_run_batch" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "computed_total" DECIMAL(15,2) NOT NULL,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recognition_run_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recognition_run_line" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "deferral_booking_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "cumulative_recognized_before" DECIMAL(15,2) NOT NULL,
    "earned_amount" DECIMAL(15,2) NOT NULL,
    "posting_execution_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "recognition_run_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fni_reserve_audit_outbox" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actor" TEXT NOT NULL,
    "correlation_id" TEXT,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fni_reserve_audit_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lender_program_config_tenant_id_lender_program_code_active_idx" ON "lender_program_config"("tenant_id", "lender_program_code", "active");

-- CreateIndex
CREATE UNIQUE INDEX "lender_program_config_tenant_id_lender_program_code_effecti_key" ON "lender_program_config"("tenant_id", "lender_program_code", "effective_from");

-- CreateIndex
CREATE INDEX "provider_program_config_tenant_id_provider_code_product_typ_idx" ON "provider_program_config"("tenant_id", "provider_code", "product_type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "provider_program_config_tenant_id_provider_code_product_typ_key" ON "provider_program_config"("tenant_id", "provider_code", "product_type", "effective_from");

-- CreateIndex
CREATE INDEX "deferral_mode_config_tenant_id_product_type_idx" ON "deferral_mode_config"("tenant_id", "product_type");

-- CreateIndex
CREATE UNIQUE INDEX "deferral_mode_config_tenant_id_product_type_effective_from_key" ON "deferral_mode_config"("tenant_id", "product_type", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "fni_schedule_mapping_tenant_id_role_key" ON "fni_schedule_mapping"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "reserve_remittance_tenant_id_deal_number_idx" ON "reserve_remittance"("tenant_id", "deal_number");

-- CreateIndex
CREATE UNIQUE INDEX "reserve_remittance_tenant_id_idempotency_key_key" ON "reserve_remittance"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "remittance_shortpay_disposition_tenant_id_remittance_id_idx" ON "remittance_shortpay_disposition"("tenant_id", "remittance_id");

-- CreateIndex
CREATE UNIQUE INDEX "remittance_shortpay_disposition_tenant_id_idempotency_key_key" ON "remittance_shortpay_disposition"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "chargeback_reserve_accrual_tenant_id_lender_program_code_idx" ON "chargeback_reserve_accrual"("tenant_id", "lender_program_code");

-- CreateIndex
CREATE INDEX "chargeback_reserve_accrual_tenant_id_control_number_idx" ON "chargeback_reserve_accrual"("tenant_id", "control_number");

-- CreateIndex
CREATE UNIQUE INDEX "chargeback_reserve_accrual_tenant_id_idempotency_key_key" ON "chargeback_reserve_accrual"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "chargeback_draw_tenant_id_lender_program_code_idx" ON "chargeback_draw"("tenant_id", "lender_program_code");

-- CreateIndex
CREATE INDEX "chargeback_draw_tenant_id_control_number_idx" ON "chargeback_draw"("tenant_id", "control_number");

-- CreateIndex
CREATE UNIQUE INDEX "chargeback_draw_tenant_id_idempotency_key_key" ON "chargeback_draw"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "remit_liability_tracking_tenant_id_provider_code_status_idx" ON "remit_liability_tracking"("tenant_id", "provider_code", "status");

-- CreateIndex
CREATE UNIQUE INDEX "remit_liability_tracking_tenant_id_deal_number_product_code_key" ON "remit_liability_tracking"("tenant_id", "deal_number", "product_code");

-- CreateIndex
CREATE INDEX "product_remit_run_tenant_id_provider_code_idx" ON "product_remit_run"("tenant_id", "provider_code");

-- CreateIndex
CREATE UNIQUE INDEX "product_remit_run_tenant_id_idempotency_key_key" ON "product_remit_run"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "product_remit_run_item_tenant_id_run_id_idx" ON "product_remit_run_item"("tenant_id", "run_id");

-- CreateIndex
CREATE INDEX "product_remit_run_item_tenant_id_deal_number_product_code_idx" ON "product_remit_run_item"("tenant_id", "deal_number", "product_code");

-- CreateIndex
CREATE INDEX "provider_statement_reconciliation_tenant_id_provider_code_idx" ON "provider_statement_reconciliation"("tenant_id", "provider_code");

-- CreateIndex
CREATE INDEX "provider_statement_line_tenant_id_reconciliation_id_idx" ON "provider_statement_line"("tenant_id", "reconciliation_id");

-- CreateIndex
CREATE INDEX "provider_statement_line_tenant_id_status_idx" ON "provider_statement_line"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "product_cancellation_tenant_id_deal_number_product_code_idx" ON "product_cancellation"("tenant_id", "deal_number", "product_code");

-- CreateIndex
CREATE UNIQUE INDEX "product_cancellation_tenant_id_idempotency_key_key" ON "product_cancellation"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "deferral_booking_tenant_id_deal_number_product_code_idx" ON "deferral_booking"("tenant_id", "deal_number", "product_code");

-- CreateIndex
CREATE INDEX "deferral_booking_tenant_id_status_idx" ON "deferral_booking"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deferral_booking_tenant_id_idempotency_key_key" ON "deferral_booking"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "recognition_run_batch_tenant_id_status_idx" ON "recognition_run_batch"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "recognition_run_line_tenant_id_batch_id_idx" ON "recognition_run_line"("tenant_id", "batch_id");

-- CreateIndex
CREATE INDEX "recognition_run_line_tenant_id_deferral_booking_id_idx" ON "recognition_run_line"("tenant_id", "deferral_booking_id");

-- CreateIndex
CREATE INDEX "fni_reserve_audit_outbox_published_at_retry_count_idx" ON "fni_reserve_audit_outbox"("published_at", "retry_count");

-- AddForeignKey
ALTER TABLE "remittance_shortpay_disposition" ADD CONSTRAINT "remittance_shortpay_disposition_remittance_id_fkey" FOREIGN KEY ("remittance_id") REFERENCES "reserve_remittance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_remit_run_item" ADD CONSTRAINT "product_remit_run_item_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "product_remit_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_statement_line" ADD CONSTRAINT "provider_statement_line_reconciliation_id_fkey" FOREIGN KEY ("reconciliation_id") REFERENCES "provider_statement_reconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferral_booking" ADD CONSTRAINT "deferral_booking_deferral_mode_config_id_fkey" FOREIGN KEY ("deferral_mode_config_id") REFERENCES "deferral_mode_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_run_line" ADD CONSTRAINT "recognition_run_line_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "recognition_run_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_run_line" ADD CONSTRAINT "recognition_run_line_deferral_booking_id_fkey" FOREIGN KEY ("deferral_booking_id") REFERENCES "deferral_booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


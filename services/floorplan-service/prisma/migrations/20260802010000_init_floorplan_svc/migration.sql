-- CE-12 (S079/S080/S081/S082) — initial schema for floorplan-service.
-- Additive-only; folder-per-migration Prisma format.
-- See services/floorplan-service/prisma/schema.prisma for field-level rationale.

-- CreateTable
CREATE TABLE "floorplan_lender_profile" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lender_code" TEXT NOT NULL,
    "lender_name" TEXT NOT NULL,
    "adapter_status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "adapter_type" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floorplan_lender_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_import_batch" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lender_code" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "fixture_label" TEXT,
    "row_count" INTEGER NOT NULL,
    "imported_by" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "floorplan_import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_staged_row" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lender_code" TEXT NOT NULL,
    "import_batch_id" TEXT NOT NULL,
    "row_type" TEXT NOT NULL,
    "vin" TEXT,
    "stock_number" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "statement_date" DATE NOT NULL,
    "reference_number" TEXT,
    "source_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STAGED',
    "supersedes_row_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_staged_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_liability_item" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lender_code" TEXT NOT NULL,
    "vin" TEXT,
    "stock_number" TEXT,
    "apply_number" TEXT NOT NULL,
    "original_amount" DECIMAL(15,2) NOT NULL,
    "remaining_balance" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "relieved_at" TIMESTAMP(3),

    CONSTRAINT "floorplan_liability_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_liability_application" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "application_type" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "match_id" TEXT,
    "curtailment_payment_id" TEXT,
    "posting_execution_id" TEXT,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_liability_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_match" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staged_row_id" TEXT NOT NULL,
    "item_id" TEXT,
    "match_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "posting_execution_id" TEXT,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,
    "failure_reason" TEXT,
    "matched_by" TEXT NOT NULL,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_break" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "break_type" TEXT NOT NULL,
    "staged_row_id" TEXT,
    "item_id" TEXT,
    "vin" TEXT,
    "stock_number" TEXT,
    "lender_amount" DECIMAL(15,2),
    "our_amount" DECIMAL(15,2),
    "variance_amount" DECIMAL(15,2),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_break_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_break_disposition" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "break_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "resulting_match_id" TEXT,
    "actor" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "floorplan_break_disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_delivery_event" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vin" TEXT,
    "stock_number" TEXT,
    "deal_number" TEXT NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "floorplan_delivery_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_sot_exception" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "delivery_event_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "grace_period_days" INTEGER NOT NULL,
    "exposure_since" TIMESTAMP(3) NOT NULL,
    "escalation_state" TEXT NOT NULL DEFAULT 'WATCH',
    "last_evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_sot_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_sot_escalation_history" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sot_exception_id" TEXT NOT NULL,
    "from_state" TEXT,
    "to_state" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_sot_escalation_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_interest_statement" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lender_code" TEXT NOT NULL,
    "statement_date" DATE NOT NULL,
    "total_interest_amount" DECIMAL(15,2) NOT NULL,
    "allocation_basis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ENTERED',
    "entered_by" TEXT NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,
    "posting_execution_id" TEXT,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,
    "failure_reason" TEXT,
    "reversal_journal_entry_id" TEXT,
    "reversal_journal_number" TEXT,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "floorplan_interest_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_interest_allocation" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "item_id" TEXT,
    "vin" TEXT,
    "stock_number" TEXT,
    "dept_code" TEXT NOT NULL,
    "bp" INTEGER NOT NULL,
    "allocated_amount" DECIMAL(15,2) NOT NULL,
    "posting_execution_id" TEXT,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,

    CONSTRAINT "floorplan_interest_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_curtailment_schedule_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lender_code" TEXT NOT NULL,
    "interval_days" INTEGER NOT NULL,
    "curtailment_percent" DECIMAL(7,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_curtailment_schedule_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_curtailment_payment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lender_code" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "vin" TEXT,
    "stock_number" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "posting_execution_id" TEXT,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,
    "failure_reason" TEXT,
    "entered_by" TEXT NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_curtailment_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_tenant_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sot_grace_period_days" INTEGER NOT NULL DEFAULT 3,
    "default_allocation_basis" TEXT NOT NULL DEFAULT 'PER_UNIT_EQUAL',
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floorplan_tenant_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplan_audit_reference" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "event_type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "floorplan_audit_reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_lender_profile_tenant_id_lender_code_key" ON "floorplan_lender_profile"("tenant_id", "lender_code");

-- CreateIndex
CREATE INDEX "floorplan_import_batch_tenant_id_lender_code_imported_at_idx" ON "floorplan_import_batch"("tenant_id", "lender_code", "imported_at");

-- CreateIndex
CREATE INDEX "floorplan_staged_row_tenant_id_lender_code_status_idx" ON "floorplan_staged_row"("tenant_id", "lender_code", "status");

-- CreateIndex
CREATE INDEX "floorplan_staged_row_tenant_id_vin_idx" ON "floorplan_staged_row"("tenant_id", "vin");

-- CreateIndex
CREATE INDEX "floorplan_staged_row_tenant_id_stock_number_idx" ON "floorplan_staged_row"("tenant_id", "stock_number");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_liability_item_tenant_id_lender_code_apply_numbe_key" ON "floorplan_liability_item"("tenant_id", "lender_code", "apply_number");

-- CreateIndex
CREATE INDEX "floorplan_liability_item_tenant_id_status_idx" ON "floorplan_liability_item"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "floorplan_liability_item_tenant_id_vin_idx" ON "floorplan_liability_item"("tenant_id", "vin");

-- CreateIndex
CREATE INDEX "floorplan_liability_item_tenant_id_stock_number_idx" ON "floorplan_liability_item"("tenant_id", "stock_number");

-- CreateIndex
CREATE INDEX "floorplan_liability_application_tenant_id_item_id_idx" ON "floorplan_liability_application"("tenant_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_match_staged_row_id_key" ON "floorplan_match"("staged_row_id");

-- CreateIndex
CREATE INDEX "floorplan_match_tenant_id_status_idx" ON "floorplan_match"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_break_staged_row_id_key" ON "floorplan_break"("staged_row_id");

-- CreateIndex
CREATE INDEX "floorplan_break_tenant_id_status_idx" ON "floorplan_break"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_break_disposition_tenant_id_idempotency_key_key" ON "floorplan_break_disposition"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "floorplan_break_disposition_tenant_id_break_id_idx" ON "floorplan_break_disposition"("tenant_id", "break_id");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_delivery_event_tenant_id_idempotency_key_key" ON "floorplan_delivery_event"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "floorplan_delivery_event_tenant_id_vin_idx" ON "floorplan_delivery_event"("tenant_id", "vin");

-- CreateIndex
CREATE INDEX "floorplan_delivery_event_tenant_id_stock_number_idx" ON "floorplan_delivery_event"("tenant_id", "stock_number");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_sot_exception_tenant_id_delivery_event_id_key" ON "floorplan_sot_exception"("tenant_id", "delivery_event_id");

-- CreateIndex
CREATE INDEX "floorplan_sot_exception_tenant_id_escalation_state_idx" ON "floorplan_sot_exception"("tenant_id", "escalation_state");

-- CreateIndex
CREATE INDEX "floorplan_sot_escalation_history_tenant_id_sot_exception_i_idx" ON "floorplan_sot_escalation_history"("tenant_id", "sot_exception_id");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_interest_statement_tenant_id_idempotency_key_key" ON "floorplan_interest_statement"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "floorplan_interest_statement_tenant_id_lender_code_stateme_idx" ON "floorplan_interest_statement"("tenant_id", "lender_code", "statement_date");

-- CreateIndex
CREATE INDEX "floorplan_interest_allocation_tenant_id_statement_id_idx" ON "floorplan_interest_allocation"("tenant_id", "statement_id");

-- CreateIndex
CREATE INDEX "floorplan_curtailment_schedule_config_tenant_id_lender_cod_idx" ON "floorplan_curtailment_schedule_config"("tenant_id", "lender_code", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_curtailment_payment_tenant_id_idempotency_key_key" ON "floorplan_curtailment_payment"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "floorplan_curtailment_payment_tenant_id_lender_code_idx" ON "floorplan_curtailment_payment"("tenant_id", "lender_code");

-- CreateIndex
CREATE UNIQUE INDEX "floorplan_tenant_config_tenant_id_key" ON "floorplan_tenant_config"("tenant_id");

-- CreateIndex
CREATE INDEX "floorplan_audit_reference_published_at_retry_count_idx" ON "floorplan_audit_reference"("published_at", "retry_count");

-- CreateIndex
CREATE INDEX "floorplan_audit_reference_tenant_id_entity_type_entity_id_idx" ON "floorplan_audit_reference"("tenant_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "floorplan_staged_row" ADD CONSTRAINT "floorplan_staged_row_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "floorplan_import_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floorplan_liability_application" ADD CONSTRAINT "floorplan_liability_application_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "floorplan_liability_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floorplan_match" ADD CONSTRAINT "floorplan_match_staged_row_id_fkey" FOREIGN KEY ("staged_row_id") REFERENCES "floorplan_staged_row"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floorplan_break" ADD CONSTRAINT "floorplan_break_staged_row_id_fkey" FOREIGN KEY ("staged_row_id") REFERENCES "floorplan_staged_row"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floorplan_break_disposition" ADD CONSTRAINT "floorplan_break_disposition_break_id_fkey" FOREIGN KEY ("break_id") REFERENCES "floorplan_break"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floorplan_sot_exception" ADD CONSTRAINT "floorplan_sot_exception_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "floorplan_liability_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floorplan_sot_escalation_history" ADD CONSTRAINT "floorplan_sot_escalation_history_sot_exception_id_fkey" FOREIGN KEY ("sot_exception_id") REFERENCES "floorplan_sot_exception"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floorplan_interest_allocation" ADD CONSTRAINT "floorplan_interest_allocation_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "floorplan_interest_statement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

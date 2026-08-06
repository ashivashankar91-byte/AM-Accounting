-- CreateTable
CREATE TABLE "deal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_number" TEXT NOT NULL,
    "deal_type" TEXT NOT NULL,
    "vin" TEXT,
    "stock_number" TEXT,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DESKED',
    "current_recap_version" INTEGER NOT NULL DEFAULT 0,
    "finalized_by_actor" TEXT,
    "funded_flag" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_recap" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "recap_version" INTEGER NOT NULL,
    "deal_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "structure_hash" TEXT NOT NULL,
    "tax_result_id" TEXT,
    "tax_amount" DECIMAL(15,2),
    "has_trade_in" BOOLEAN NOT NULL DEFAULT false,
    "trade_allowance_amount" DECIMAL(15,2),
    "trade_acv_amount" DECIMAL(15,2),
    "commission_basis_snapshot" JSONB,
    "rebate_receivable_amount" DECIMAL(15,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "deal_recap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_review_case" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "recap_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "auto_posted" BOOLEAN NOT NULL DEFAULT false,
    "held_reason" TEXT,
    "held_by" TEXT,
    "held_at" TIMESTAMP(3),
    "returned_reason" TEXT,
    "returned_by" TEXT,
    "returned_at" TIMESTAMP(3),
    "released_by" TEXT,
    "released_at" TIMESTAMP(3),
    "preview_blueprint_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_review_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_posting_record" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "recap_version" INTEGER,
    "segment_type" TEXT NOT NULL,
    "product_index" INTEGER,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "coa_status" TEXT NOT NULL,
    "coa_execution_id" TEXT,
    "rule_pack_version_id" TEXT,
    "rule_id" TEXT,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,
    "blueprint_hash" TEXT,
    "failure_reason" TEXT,
    "reversal_of_posting_record_id" TEXT,
    "reversal_journal_entry_id" TEXT,
    "reversal_journal_number" TEXT,
    "reversed_at" TIMESTAMP(3),
    "amounts_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "deal_posting_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_open_item" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "item_number" TEXT NOT NULL,
    "product_index" INTEGER,
    "original_amount" DECIMAL(15,2) NOT NULL,
    "applied_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "remaining_balance" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_by_posting_record_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "deal_open_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_open_item_application" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "open_item_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_record_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "applied_by" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "deal_open_item_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cit_funding_receipt" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "lender_ref" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "cit_original_amount" DECIMAL(15,2) NOT NULL,
    "shortfall_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'MATCHED',
    "disposition_type" TEXT,
    "disposition_reason" TEXT,
    "dispositioned_by" TEXT,
    "dispositioned_at" TIMESTAMP(3),
    "fee_posting_record_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "cit_funding_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payoff_issuance" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "recap_payoff_amount" DECIMAL(15,2) NOT NULL,
    "actual_amount" DECIMAL(15,2) NOT NULL,
    "variance_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "variance_disposition" TEXT,
    "variance_reason" TEXT,
    "posting_record_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" TEXT NOT NULL,

    CONSTRAINT "payoff_issuance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wholesale_disposition" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "unit_ref" TEXT NOT NULL,
    "title_status" TEXT NOT NULL,
    "wholesale_amount" DECIMAL(15,2) NOT NULL,
    "unit_relief_amount" DECIMAL(15,2) NOT NULL,
    "auction_fees_amount" DECIMAL(15,2) NOT NULL,
    "disposition_outcome" TEXT NOT NULL,
    "gain_loss_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "posting_record_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "wholesale_disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arbitration_case" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "disposition_id" TEXT NOT NULL,
    "arbitration_type" TEXT NOT NULL,
    "adjustment_amount" DECIMAL(15,2),
    "condition_cost_amount" DECIMAL(15,2),
    "reason" TEXT NOT NULL,
    "posting_record_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "arbitration_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_unwind" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "recap_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refusal_code" TEXT,
    "refusal_detail" TEXT,
    "reversal_posting_record_ids" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "executed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executed_by" TEXT NOT NULL,

    CONSTRAINT "deal_unwind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_recontract" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "from_recap_version" INTEGER NOT NULL,
    "to_recap_version" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "structure_hash_from" TEXT NOT NULL,
    "structure_hash_to" TEXT NOT NULL,
    "delta_posting_record_id" TEXT,
    "reversal_posting_record_id" TEXT,
    "repost_posting_record_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "deal_recontract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_tenant_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "auto_post_enabled" BOOLEAN NOT NULL DEFAULT false,
    "cit_funding_delay_threshold_days" INTEGER NOT NULL DEFAULT 5,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "deal_tenant_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_audit_reference" (
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

    CONSTRAINT "deal_audit_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_outbox_event" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deal_tenant_id_status_idx" ON "deal"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deal_tenant_id_deal_number_key" ON "deal"("tenant_id", "deal_number");

-- CreateIndex
CREATE INDEX "deal_recap_tenant_id_deal_id_idx" ON "deal_recap"("tenant_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_recap_tenant_id_deal_id_recap_version_key" ON "deal_recap"("tenant_id", "deal_id", "recap_version");

-- CreateIndex
CREATE INDEX "deal_review_case_tenant_id_status_idx" ON "deal_review_case"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deal_review_case_tenant_id_deal_id_recap_version_key" ON "deal_review_case"("tenant_id", "deal_id", "recap_version");

-- CreateIndex
CREATE INDEX "deal_posting_record_tenant_id_deal_id_idx" ON "deal_posting_record"("tenant_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_posting_record_tenant_id_event_id_key" ON "deal_posting_record"("tenant_id", "event_id");

-- CreateIndex
CREATE INDEX "deal_open_item_tenant_id_deal_id_idx" ON "deal_open_item"("tenant_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_open_item_tenant_id_item_type_item_number_key" ON "deal_open_item"("tenant_id", "item_type", "item_number");

-- CreateIndex
CREATE INDEX "deal_open_item_application_tenant_id_open_item_id_idx" ON "deal_open_item_application"("tenant_id", "open_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_open_item_application_tenant_id_idempotency_key_key" ON "deal_open_item_application"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "cit_funding_receipt_tenant_id_deal_id_idx" ON "cit_funding_receipt"("tenant_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "cit_funding_receipt_tenant_id_idempotency_key_key" ON "cit_funding_receipt"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payoff_issuance_tenant_id_idempotency_key_key" ON "payoff_issuance"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payoff_issuance_tenant_id_deal_id_key" ON "payoff_issuance"("tenant_id", "deal_id");

-- CreateIndex
CREATE INDEX "wholesale_disposition_tenant_id_deal_id_idx" ON "wholesale_disposition"("tenant_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "wholesale_disposition_tenant_id_idempotency_key_key" ON "wholesale_disposition"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "arbitration_case_tenant_id_disposition_id_idx" ON "arbitration_case"("tenant_id", "disposition_id");

-- CreateIndex
CREATE UNIQUE INDEX "arbitration_case_tenant_id_idempotency_key_key" ON "arbitration_case"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "deal_unwind_tenant_id_deal_id_idx" ON "deal_unwind"("tenant_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_unwind_tenant_id_idempotency_key_key" ON "deal_unwind"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "deal_recontract_tenant_id_deal_id_idx" ON "deal_recontract"("tenant_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "deal_recontract_tenant_id_idempotency_key_key" ON "deal_recontract"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "deal_tenant_config_tenant_id_key" ON "deal_tenant_config"("tenant_id");

-- CreateIndex
CREATE INDEX "deal_audit_reference_tenant_id_doc_type_doc_id_idx" ON "deal_audit_reference"("tenant_id", "doc_type", "doc_id");

-- CreateIndex
CREATE INDEX "deal_outbox_event_tenant_id_event_type_idx" ON "deal_outbox_event"("tenant_id", "event_type");

-- AddForeignKey
ALTER TABLE "deal_recap" ADD CONSTRAINT "deal_recap_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_review_case" ADD CONSTRAINT "deal_review_case_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_posting_record" ADD CONSTRAINT "deal_posting_record_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_open_item" ADD CONSTRAINT "deal_open_item_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_open_item_application" ADD CONSTRAINT "deal_open_item_application_open_item_id_fkey" FOREIGN KEY ("open_item_id") REFERENCES "deal_open_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arbitration_case" ADD CONSTRAINT "arbitration_case_disposition_id_fkey" FOREIGN KEY ("disposition_id") REFERENCES "wholesale_disposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


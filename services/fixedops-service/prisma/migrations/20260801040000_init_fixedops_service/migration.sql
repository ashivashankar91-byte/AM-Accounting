-- CreateTable
CREATE TABLE "wip_mode_election" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT,
    "mode" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "impact_preview" JSONB,
    "approved_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wip_mode_election_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repair_order" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "ro_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "current_close_version" INTEGER NOT NULL DEFAULT 0,
    "wip_mode" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repair_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ro_close_submission" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "repair_order_id" TEXT NOT NULL,
    "ro_number" TEXT NOT NULL,
    "close_version" INTEGER NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "pay_type_mix" TEXT NOT NULL,
    "total_sale_amount" DECIMAL(15,2) NOT NULL,
    "total_cost_amount" DECIMAL(15,2) NOT NULL,
    "total_tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,
    "rule_pack_version_id" TEXT,
    "failure_reason" TEXT,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ro_close_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ro_distribution_line" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ro_close_submission_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "pay_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "opcode" TEXT,
    "tech_id" TEXT,
    "part_number" TEXT,
    "sale_amount" DECIMAL(15,2) NOT NULL,
    "cost_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "tax_result_id" TEXT,
    "tax_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ro_distribution_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ro_reversal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "repair_order_id" TEXT NOT NULL,
    "ro_number" TEXT NOT NULL,
    "close_version_reversed" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "original_journal_entry_id" TEXT NOT NULL,
    "reversal_journal_entry_id" TEXT,
    "source_event_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "refusal_code" TEXT,
    "reason" TEXT,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ro_reversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_guarantee_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "tech_id" TEXT NOT NULL,
    "guaranteed_hours_per_period" DECIMAL(8,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_guarantee_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_time_absorption" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "tech_id" TEXT NOT NULL,
    "payroll_period_id" TEXT NOT NULL,
    "clocked_hours" DECIMAL(8,2) NOT NULL,
    "flagged_applied_hours" DECIMAL(8,2) NOT NULL,
    "unapplied_hours" DECIMAL(8,2) NOT NULL,
    "guaranteed_hours" DECIMAL(8,2) NOT NULL,
    "shortfall_hours" DECIMAL(8,2) NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_time_absorption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferred_maintenance_contract" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "contract_number" TEXT NOT NULL,
    "sold_amount" DECIMAL(15,2) NOT NULL,
    "deferred_balance" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sale_source_event_id" TEXT NOT NULL,
    "sale_journal_entry_id" TEXT NOT NULL,
    "sold_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deferred_maintenance_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferred_maintenance_redemption" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "ro_number" TEXT NOT NULL,
    "redeemed_amount" DECIMAL(15,2) NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "journal_entry_id" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deferred_maintenance_redemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sublet_purchase_order" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "ro_number" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "estimated_cost" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "accrual_source_event_id" TEXT,
    "accrual_journal_entry_id" TEXT,
    "accrual_amount" DECIMAL(15,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sublet_purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sublet_invoice_match" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sublet_po_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "invoice_amount" DECIMAL(15,2) NOT NULL,
    "variance_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "source_event_id" TEXT NOT NULL,
    "relief_journal_entry_id" TEXT,
    "status" TEXT NOT NULL,
    "matched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sublet_invoice_match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claim_item" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "ro_number" TEXT NOT NULL,
    "claim_number" TEXT NOT NULL,
    "sale_amount" DECIMAL(15,2) NOT NULL,
    "remaining_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BORN',
    "birth_source_event_id" TEXT NOT NULL,
    "birth_journal_entry_id" TEXT NOT NULL,
    "factory_age_band" TEXT,
    "schedule_projection_pending" BOOLEAN NOT NULL DEFAULT true,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranty_claim_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claim_remittance" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "remitted_amount" DECIMAL(15,2) NOT NULL,
    "source_receipt_id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "remitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranty_claim_remittance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warranty_claim_disposition" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warranty_claim_disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixedops_account_mapping" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "event_family" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "account_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACCOUNT_MAPPING_VALUES_PENDING',
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixedops_account_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixedops_posting_exception" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT,
    "source_event_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "event_family" TEXT NOT NULL,
    "ro_number" TEXT,
    "reason_code" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixedops_posting_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixedops_audit_outbox_event" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "correlation_id" TEXT,
    "actor" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "fixedops_audit_outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wip_mode_election_tenant_id_legal_entity_id_store_id_effect_idx" ON "wip_mode_election"("tenant_id", "legal_entity_id", "store_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "repair_order_tenant_id_store_id_ro_number_key" ON "repair_order"("tenant_id", "store_id", "ro_number");

-- CreateIndex
CREATE INDEX "ro_close_submission_tenant_id_store_id_status_idx" ON "ro_close_submission"("tenant_id", "store_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ro_close_submission_tenant_id_ro_number_close_version_key" ON "ro_close_submission"("tenant_id", "ro_number", "close_version");

-- CreateIndex
CREATE INDEX "ro_distribution_line_tenant_id_ro_close_submission_id_idx" ON "ro_distribution_line"("tenant_id", "ro_close_submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "ro_reversal_tenant_id_ro_number_close_version_reversed_acti_key" ON "ro_reversal"("tenant_id", "ro_number", "close_version_reversed", "action");

-- CreateIndex
CREATE INDEX "tech_guarantee_config_tenant_id_tech_id_effective_from_idx" ON "tech_guarantee_config"("tenant_id", "tech_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "tech_time_absorption_tenant_id_tech_id_payroll_period_id_key" ON "tech_time_absorption"("tenant_id", "tech_id", "payroll_period_id");

-- CreateIndex
CREATE UNIQUE INDEX "deferred_maintenance_contract_tenant_id_contract_number_key" ON "deferred_maintenance_contract"("tenant_id", "contract_number");

-- CreateIndex
CREATE UNIQUE INDEX "deferred_maintenance_redemption_tenant_id_contract_id_ro_nu_key" ON "deferred_maintenance_redemption"("tenant_id", "contract_id", "ro_number", "source_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "sublet_purchase_order_tenant_id_po_number_key" ON "sublet_purchase_order"("tenant_id", "po_number");

-- CreateIndex
CREATE UNIQUE INDEX "sublet_invoice_match_tenant_id_sublet_po_id_invoice_id_key" ON "sublet_invoice_match"("tenant_id", "sublet_po_id", "invoice_id");

-- CreateIndex
CREATE INDEX "warranty_claim_item_tenant_id_store_id_status_idx" ON "warranty_claim_item"("tenant_id", "store_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claim_item_tenant_id_claim_number_key" ON "warranty_claim_item"("tenant_id", "claim_number");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claim_remittance_tenant_id_claim_id_source_event_i_key" ON "warranty_claim_remittance"("tenant_id", "claim_id", "source_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "warranty_claim_disposition_tenant_id_claim_id_source_event__key" ON "warranty_claim_disposition"("tenant_id", "claim_id", "source_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixedops_account_mapping_tenant_id_legal_entity_id_event_fa_key" ON "fixedops_account_mapping"("tenant_id", "legal_entity_id", "event_family", "role");

-- CreateIndex
CREATE INDEX "fixedops_posting_exception_tenant_id_status_reason_code_idx" ON "fixedops_posting_exception"("tenant_id", "status", "reason_code");

-- CreateIndex
CREATE INDEX "fixedops_audit_outbox_event_tenant_id_published_at_idx" ON "fixedops_audit_outbox_event"("tenant_id", "published_at");

-- AddForeignKey
ALTER TABLE "ro_close_submission" ADD CONSTRAINT "ro_close_submission_repair_order_id_fkey" FOREIGN KEY ("repair_order_id") REFERENCES "repair_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_distribution_line" ADD CONSTRAINT "ro_distribution_line_ro_close_submission_id_fkey" FOREIGN KEY ("ro_close_submission_id") REFERENCES "ro_close_submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ro_reversal" ADD CONSTRAINT "ro_reversal_repair_order_id_fkey" FOREIGN KEY ("repair_order_id") REFERENCES "repair_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferred_maintenance_redemption" ADD CONSTRAINT "deferred_maintenance_redemption_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "deferred_maintenance_contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sublet_invoice_match" ADD CONSTRAINT "sublet_invoice_match_sublet_po_id_fkey" FOREIGN KEY ("sublet_po_id") REFERENCES "sublet_purchase_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim_remittance" ADD CONSTRAINT "warranty_claim_remittance_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "warranty_claim_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warranty_claim_disposition" ADD CONSTRAINT "warranty_claim_disposition_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "warranty_claim_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "parts_valuation_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "landed_cost_rules" JSONB,
    "effective_from" DATE NOT NULL,
    "ceremony_approved_by" TEXT NOT NULL,
    "revaluation_preview_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_valuation_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_movement" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "movement_family" TEXT NOT NULL,
    "movement_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_value" DECIMAL(15,4) NOT NULL,
    "total_value" DECIMAL(15,2) NOT NULL,
    "source_doc_type" TEXT NOT NULL,
    "source_doc_id" TEXT NOT NULL,
    "source_event_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "journal_entry_id" TEXT,
    "journal_number" TEXT,
    "negative_on_hand_flag" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_perpetual_balance" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "on_hand_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "on_hand_value" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parts_perpetual_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_reconciliation_run" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT,
    "as_of_date" DATE NOT NULL,
    "perpetual_total" DECIMAL(15,2) NOT NULL,
    "gl_control_total" DECIMAL(15,2) NOT NULL,
    "variance_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "run_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_reconciliation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_reconciliation_variance_line" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "movement_id" TEXT,
    "explained_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "unexplained_amount" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "parts_reconciliation_variance_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tape_load" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "load_batch_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOADED',
    "preview_total" DECIMAL(15,2),
    "approved_total" DECIMAL(15,2),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "source_event_id" TEXT,
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_tape_load_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tape_line" (
    "id" TEXT NOT NULL,
    "tape_load_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "old_value" DECIMAL(15,4) NOT NULL,
    "new_value" DECIMAL(15,4) NOT NULL,
    "qty_on_hand" DECIMAL(12,3) NOT NULL,
    "delta_value" DECIMAL(15,2) NOT NULL,
    "effective_from" DATE NOT NULL,

    CONSTRAINT "price_tape_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obsolescence_provision_run" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "band_config" JSONB NOT NULL,
    "preview_total" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEWED',
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "source_event_id" TEXT,
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "obsolescence_provision_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obsolescence_provision_line" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "age_band" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "provision_amount" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "obsolescence_provision_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrap_disposal" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "value" DECIMAL(15,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "threshold_amount" DECIMAL(15,2),
    "threshold_exceeded" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "source_event_id" TEXT,
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrap_disposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_inventory_session" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "scope_description" TEXT NOT NULL,
    "blind_count" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "variance_threshold" DECIMAL(15,2),
    "frozen_at" TIMESTAMP(3),
    "counted_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "source_event_id" TEXT,
    "journal_entry_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "physical_inventory_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_inventory_count_line" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "perpetual_qty_snapshot" DECIMAL(12,3) NOT NULL,
    "perpetual_value_snapshot" DECIMAL(15,2) NOT NULL,
    "counted_qty" DECIMAL(12,3),
    "variance_qty" DECIMAL(12,3),
    "variance_value" DECIMAL(15,2),

    CONSTRAINT "physical_inventory_count_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escheat_jurisdiction_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "dormancy_period_days" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escheat_jurisdiction_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "special_order_deposit" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_ref" TEXT NOT NULL,
    "deposit_amount" DECIMAL(15,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "deposit_source_event_id" TEXT NOT NULL,
    "deposit_journal_entry_id" TEXT NOT NULL,
    "applied_journal_entry_id" TEXT,
    "refund_journal_entry_id" TEXT,
    "aging_since_date" DATE NOT NULL,
    "jurisdiction" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "special_order_deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_return_program_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "oem_code" TEXT NOT NULL,
    "allowance_pct" DECIMAL(5,2) NOT NULL,
    "restocking_fee_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_return_program_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_return_authorization" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "oem_code" TEXT NOT NULL,
    "return_auth_number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AUTHORIZED',
    "ship_source_event_id" TEXT,
    "ship_journal_entry_id" TEXT,
    "credit_source_event_id" TEXT,
    "credit_journal_entry_id" TEXT,
    "restocking_fee_variance" DECIMAL(15,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oem_return_authorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oem_return_line" (
    "id" TEXT NOT NULL,
    "return_auth_id" TEXT NOT NULL,
    "part_number" TEXT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "value" DECIMAL(15,2) NOT NULL,

    CONSTRAINT "oem_return_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_account_mapping" (
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

    CONSTRAINT "parts_account_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_posting_exception" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "store_id" TEXT,
    "source_event_id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "event_family" TEXT NOT NULL,
    "part_number" TEXT,
    "reason_code" TEXT NOT NULL,
    "detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parts_posting_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parts_audit_outbox_event" (
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
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "parts_audit_outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parts_valuation_config_tenant_id_legal_entity_id_effective__idx" ON "parts_valuation_config"("tenant_id", "legal_entity_id", "effective_from");

-- CreateIndex
CREATE INDEX "parts_movement_tenant_id_store_id_part_number_idx" ON "parts_movement"("tenant_id", "store_id", "part_number");

-- CreateIndex
CREATE INDEX "parts_movement_tenant_id_negative_on_hand_flag_idx" ON "parts_movement"("tenant_id", "negative_on_hand_flag");

-- CreateIndex
CREATE UNIQUE INDEX "parts_movement_tenant_id_movement_id_key" ON "parts_movement"("tenant_id", "movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_perpetual_balance_tenant_id_legal_entity_id_store_id__key" ON "parts_perpetual_balance"("tenant_id", "legal_entity_id", "store_id", "part_number");

-- CreateIndex
CREATE INDEX "parts_reconciliation_run_tenant_id_legal_entity_id_store_id_idx" ON "parts_reconciliation_run"("tenant_id", "legal_entity_id", "store_id", "as_of_date");

-- CreateIndex
CREATE INDEX "parts_reconciliation_variance_line_run_id_idx" ON "parts_reconciliation_variance_line"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_tape_load_tenant_id_load_batch_id_key" ON "price_tape_load"("tenant_id", "load_batch_id");

-- CreateIndex
CREATE INDEX "price_tape_line_tape_load_id_idx" ON "price_tape_line"("tape_load_id");

-- CreateIndex
CREATE INDEX "obsolescence_provision_line_run_id_idx" ON "obsolescence_provision_line"("run_id");

-- CreateIndex
CREATE INDEX "physical_inventory_count_line_session_id_idx" ON "physical_inventory_count_line"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "escheat_jurisdiction_config_tenant_id_legal_entity_id_juris_key" ON "escheat_jurisdiction_config"("tenant_id", "legal_entity_id", "jurisdiction", "effective_from");

-- CreateIndex
CREATE INDEX "special_order_deposit_tenant_id_status_aging_since_date_idx" ON "special_order_deposit"("tenant_id", "status", "aging_since_date");

-- CreateIndex
CREATE UNIQUE INDEX "special_order_deposit_tenant_id_order_number_key" ON "special_order_deposit"("tenant_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "oem_return_program_config_tenant_id_legal_entity_id_oem_cod_key" ON "oem_return_program_config"("tenant_id", "legal_entity_id", "oem_code", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "oem_return_authorization_tenant_id_return_auth_number_key" ON "oem_return_authorization"("tenant_id", "return_auth_number");

-- CreateIndex
CREATE INDEX "oem_return_line_return_auth_id_idx" ON "oem_return_line"("return_auth_id");

-- CreateIndex
CREATE UNIQUE INDEX "parts_account_mapping_tenant_id_legal_entity_id_event_famil_key" ON "parts_account_mapping"("tenant_id", "legal_entity_id", "event_family", "role");

-- CreateIndex
CREATE INDEX "parts_posting_exception_tenant_id_status_reason_code_idx" ON "parts_posting_exception"("tenant_id", "status", "reason_code");

-- CreateIndex
CREATE INDEX "parts_audit_outbox_event_tenant_id_published_at_idx" ON "parts_audit_outbox_event"("tenant_id", "published_at");

-- AddForeignKey
ALTER TABLE "parts_reconciliation_variance_line" ADD CONSTRAINT "parts_reconciliation_variance_line_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "parts_reconciliation_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tape_line" ADD CONSTRAINT "price_tape_line_tape_load_id_fkey" FOREIGN KEY ("tape_load_id") REFERENCES "price_tape_load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obsolescence_provision_line" ADD CONSTRAINT "obsolescence_provision_line_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "obsolescence_provision_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_inventory_count_line" ADD CONSTRAINT "physical_inventory_count_line_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "physical_inventory_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oem_return_line" ADD CONSTRAINT "oem_return_line_return_auth_id_fkey" FOREIGN KEY ("return_auth_id") REFERENCES "oem_return_authorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


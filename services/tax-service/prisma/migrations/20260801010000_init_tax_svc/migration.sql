-- CE-10 (S124/S125) — initial schema for tax-service.
-- Additive-only; folder-per-migration Prisma format.
-- See services/tax-service/prisma/schema.prisma for field-level rationale.

-- CreateTable
CREATE TABLE "tax_engine_config" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "engine_type" TEXT NOT NULL,
    "engine_version" TEXT,
    "content_version" TEXT,
    "connection_config" JSONB,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_engine_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdiction_registration" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "jurisdiction_ref" TEXT NOT NULL,
    "jurisdiction_level" TEXT,
    "registration_number" TEXT,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdiction_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exemption_certificate" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "party_ref" TEXT NOT NULL,
    "jurisdiction_scope" TEXT NOT NULL,
    "exemption_type_code" TEXT NOT NULL,
    "certificate_document_metadata" JSONB,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exemption_certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_result" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "document_version" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "engine_type" TEXT NOT NULL,
    "engine_version" TEXT,
    "content_version" TEXT,
    "engine_result_id" TEXT,
    "engine_reject_reason" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "total_taxable_base" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "request_snapshot" JSONB NOT NULL,
    "response_snapshot" JSONB,
    "correlation_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "previous_result_id" TEXT,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_result_line" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tax_result_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "jurisdiction_id" TEXT NOT NULL,
    "jurisdiction_level" TEXT,
    "tax_type" TEXT NOT NULL,
    "rate" DECIMAL(9,6),
    "taxable_base" DECIMAL(15,2) NOT NULL,
    "tax_amount" DECIMAL(15,2) NOT NULL,
    "engine_result_line_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_result_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_integrity_alert" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "original_result_id" TEXT NOT NULL,
    "divergent_request_snapshot" JSONB NOT NULL,
    "divergent_response_snapshot" JSONB,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_integrity_alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_engine_attempt_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_engine_attempt_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_exception" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reason_detail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PARKED',
    "request_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tax_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_exception_disposition" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "exception_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_exception_disposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_account_mapping_ref" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "fee_code" TEXT,
    "mapping_status" TEXT NOT NULL DEFAULT 'ACCOUNT_MAPPING_VALUES_PENDING',
    "mapping_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_account_mapping_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_table" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "jurisdiction_ref" TEXT NOT NULL,
    "fee_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "amount" DECIMAL(15,2),
    "rate_percent" DECIMAL(7,4),
    "taxability_flag" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_table_applicability_tag" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fee_table_id" TEXT NOT NULL,
    "item_class_code" TEXT,
    "document_type_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_table_applicability_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_table_usage_reference" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "fee_table_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_table_usage_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_audit_reference" (
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

    CONSTRAINT "tax_audit_reference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_engine_config_tenant_id_legal_entity_id_effective_from_idx" ON "tax_engine_config"("tenant_id", "legal_entity_id", "effective_from");

-- CreateIndex
CREATE INDEX "jurisdiction_registration_tenant_id_legal_entity_id_jurisdi_idx" ON "jurisdiction_registration"("tenant_id", "legal_entity_id", "jurisdiction_ref", "effective_from");

-- CreateIndex
CREATE INDEX "exemption_certificate_tenant_id_legal_entity_id_party_ref_idx" ON "exemption_certificate"("tenant_id", "legal_entity_id", "party_ref");

-- CreateIndex
CREATE INDEX "exemption_certificate_tenant_id_legal_entity_id_effective_t_idx" ON "exemption_certificate"("tenant_id", "legal_entity_id", "effective_to");

-- CreateIndex
CREATE INDEX "tax_result_tenant_id_legal_entity_id_document_type_document_idx" ON "tax_result"("tenant_id", "legal_entity_id", "document_type", "document_id");

-- CreateIndex
CREATE INDEX "tax_result_tenant_id_business_date_idx" ON "tax_result"("tenant_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "tax_result_tenant_id_idempotency_key_key" ON "tax_result"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "tax_result_line_tenant_id_tax_result_id_idx" ON "tax_result_line"("tenant_id", "tax_result_id");

-- CreateIndex
CREATE INDEX "tax_result_line_tenant_id_jurisdiction_id_idx" ON "tax_result_line"("tenant_id", "jurisdiction_id");

-- CreateIndex
CREATE INDEX "tax_integrity_alert_tenant_id_idempotency_key_idx" ON "tax_integrity_alert"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "tax_engine_attempt_log_tenant_id_idempotency_key_idx" ON "tax_engine_attempt_log"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "tax_exception_tenant_id_status_idx" ON "tax_exception"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tax_exception_tenant_id_idempotency_key_idx" ON "tax_exception"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "tax_exception_disposition_tenant_id_exception_id_idx" ON "tax_exception_disposition"("tenant_id", "exception_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_account_mapping_ref_tenant_id_legal_entity_id_event_typ_key" ON "tax_account_mapping_ref"("tenant_id", "legal_entity_id", "event_type", "fee_code");

-- CreateIndex
CREATE INDEX "fee_table_tenant_id_legal_entity_id_fee_code_effective_from_idx" ON "fee_table"("tenant_id", "legal_entity_id", "fee_code", "effective_from");

-- CreateIndex
CREATE INDEX "fee_table_applicability_tag_tenant_id_fee_table_id_idx" ON "fee_table_applicability_tag"("tenant_id", "fee_table_id");

-- CreateIndex
CREATE INDEX "fee_table_usage_reference_tenant_id_fee_table_id_idx" ON "fee_table_usage_reference"("tenant_id", "fee_table_id");

-- CreateIndex
CREATE INDEX "tax_audit_reference_published_at_retry_count_idx" ON "tax_audit_reference"("published_at", "retry_count");

-- CreateIndex
CREATE INDEX "tax_audit_reference_tenant_id_entity_type_entity_id_idx" ON "tax_audit_reference"("tenant_id", "entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "tax_result_line" ADD CONSTRAINT "tax_result_line_tax_result_id_fkey" FOREIGN KEY ("tax_result_id") REFERENCES "tax_result"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_exception_disposition" ADD CONSTRAINT "tax_exception_disposition_exception_id_fkey" FOREIGN KEY ("exception_id") REFERENCES "tax_exception"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_table_applicability_tag" ADD CONSTRAINT "fee_table_applicability_tag_fee_table_id_fkey" FOREIGN KEY ("fee_table_id") REFERENCES "fee_table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_table_usage_reference" ADD CONSTRAINT "fee_table_usage_reference_fee_table_id_fkey" FOREIGN KEY ("fee_table_id") REFERENCES "fee_table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


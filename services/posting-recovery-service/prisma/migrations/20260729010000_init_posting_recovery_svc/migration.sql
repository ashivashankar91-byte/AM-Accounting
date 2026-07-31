-- S021 Posting Recovery — first-slice schema.
-- New service (posting-recovery-service): does not touch, extend, or
-- rename any GL journal table owned by gl-service/coa-service.
--
-- R1 S021-completion addition (event_schema_version, source_entity_id,
-- original_event_published_at): the foundation slice's captured columns
-- were not sufficient to reconstruct a byte-identical CH01 SourceEventEnvelope
-- for real replay (event_schema_version drives CH01 rule-pack version
-- selection; source_entity_id is part of CH01's identity hash). Folded into
-- this still-unintegrated init migration rather than a superseding
-- migration, since no production data exists for this brand-new service.
-- Nullable at the DB level (defensive); DeadLetterIntakeService requires
-- them for all new intake.

CREATE TABLE "posting_dead_letter" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT,
    "store_id" TEXT,
    "source_event_id" TEXT NOT NULL,
    "source_event_type" TEXT NOT NULL,
    "event_schema_version" TEXT,
    "source_system" TEXT NOT NULL,
    "source_entity_type" TEXT,
    "source_entity_id" TEXT,
    "source_transaction_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "causation_id" TEXT,
    "original_event_timestamp" TIMESTAMP(3) NOT NULL,
    "original_event_published_at" TIMESTAMP(3),
    "business_date" DATE,
    "posting_idempotency_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "contains_sensitive_data" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'QUARANTINED',
    "first_failure_at" TIMESTAMP(3) NOT NULL,
    "latest_failure_at" TIMESTAMP(3) NOT NULL,
    "latest_failure_category" TEXT NOT NULL,
    "latest_failure_code" TEXT NOT NULL,
    "latest_failure_message" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "assigned_owner" TEXT,
    "escalation_state" TEXT,
    "journal_reference" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posting_dead_letter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "posting_dead_letter_tenant_id_source_event_id_key" ON "posting_dead_letter"("tenant_id", "source_event_id");
CREATE INDEX "posting_dead_letter_tenant_id_status_idx" ON "posting_dead_letter"("tenant_id", "status");
CREATE INDEX "posting_dead_letter_tenant_id_correlation_id_idx" ON "posting_dead_letter"("tenant_id", "correlation_id");
CREATE INDEX "posting_dead_letter_tenant_id_source_transaction_id_idx" ON "posting_dead_letter"("tenant_id", "source_transaction_id");
CREATE INDEX "posting_dead_letter_tenant_id_latest_failure_category_idx" ON "posting_dead_letter"("tenant_id", "latest_failure_category");
CREATE INDEX "posting_dead_letter_tenant_id_first_failure_at_idx" ON "posting_dead_letter"("tenant_id", "first_failure_at");
CREATE INDEX "posting_dead_letter_tenant_id_assigned_owner_idx" ON "posting_dead_letter"("tenant_id", "assigned_owner");

CREATE TABLE "posting_dead_letter_failure" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dead_letter_id" TEXT NOT NULL,
    "failure_category" TEXT NOT NULL,
    "failure_code" TEXT NOT NULL,
    "failure_stage" TEXT NOT NULL,
    "failure_message" TEXT NOT NULL,
    "field_errors" JSONB,
    "rule_context" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_dead_letter_failure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "posting_dead_letter_failure_tenant_id_dead_letter_id_idx" ON "posting_dead_letter_failure"("tenant_id", "dead_letter_id");
CREATE INDEX "posting_dead_letter_failure_tenant_id_failure_category_idx" ON "posting_dead_letter_failure"("tenant_id", "failure_category");

ALTER TABLE "posting_dead_letter_failure" ADD CONSTRAINT "posting_dead_letter_failure_dead_letter_id_fkey"
  FOREIGN KEY ("dead_letter_id") REFERENCES "posting_dead_letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "posting_replay_attempt" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dead_letter_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "authorized_by" TEXT,
    "authorized_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "result_message" TEXT,
    "resulting_journal_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_replay_attempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "posting_replay_attempt_dead_letter_id_attempt_number_key" ON "posting_replay_attempt"("dead_letter_id", "attempt_number");
CREATE INDEX "posting_replay_attempt_tenant_id_dead_letter_id_idx" ON "posting_replay_attempt"("tenant_id", "dead_letter_id");

ALTER TABLE "posting_replay_attempt" ADD CONSTRAINT "posting_replay_attempt_dead_letter_id_fkey"
  FOREIGN KEY ("dead_letter_id") REFERENCES "posting_dead_letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "posting_correction_revision" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dead_letter_id" TEXT NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "correction_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "proposed_changes" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_correction_revision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "posting_correction_revision_dead_letter_id_revision_number_key" ON "posting_correction_revision"("dead_letter_id", "revision_number");
CREATE INDEX "posting_correction_revision_tenant_id_dead_letter_id_idx" ON "posting_correction_revision"("tenant_id", "dead_letter_id");

ALTER TABLE "posting_correction_revision" ADD CONSTRAINT "posting_correction_revision_dead_letter_id_fkey"
  FOREIGN KEY ("dead_letter_id") REFERENCES "posting_dead_letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "posting_case_transition" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dead_letter_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "reason" TEXT,
    "actor" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_case_transition_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "posting_case_transition_tenant_id_dead_letter_id_idx" ON "posting_case_transition"("tenant_id", "dead_letter_id");

ALTER TABLE "posting_case_transition" ADD CONSTRAINT "posting_case_transition_dead_letter_id_fkey"
  FOREIGN KEY ("dead_letter_id") REFERENCES "posting_dead_letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "posting_case_assignment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dead_letter_id" TEXT NOT NULL,
    "assigned_to" TEXT,
    "assigned_by" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_case_assignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "posting_case_assignment_tenant_id_dead_letter_id_idx" ON "posting_case_assignment"("tenant_id", "dead_letter_id");

ALTER TABLE "posting_case_assignment" ADD CONSTRAINT "posting_case_assignment_dead_letter_id_fkey"
  FOREIGN KEY ("dead_letter_id") REFERENCES "posting_dead_letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "posting_recovery_audit_reference" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dead_letter_id" TEXT,
    "event_type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posting_recovery_audit_reference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "posting_recovery_audit_reference_published_at_retry_count_idx" ON "posting_recovery_audit_reference"("published_at", "retry_count");
CREATE INDEX "posting_recovery_audit_reference_tenant_id_dead_letter_id_idx" ON "posting_recovery_audit_reference"("tenant_id", "dead_letter_id");

ALTER TABLE "posting_recovery_audit_reference" ADD CONSTRAINT "posting_recovery_audit_reference_dead_letter_id_fkey"
  FOREIGN KEY ("dead_letter_id") REFERENCES "posting_dead_letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

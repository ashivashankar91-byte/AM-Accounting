-- === auth-service ===
-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['read', 'write']::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");


-- === tenant-service ===
-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dms_type" TEXT NOT NULL,
    "dms_api_key" TEXT NOT NULL,
    "schema_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROVISIONING',
    "rooftop_count" INTEGER NOT NULL DEFAULT 1,
    "webhook_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_schema_name_key" ON "tenants"("schema_name");


-- === gl-service ===
-- CreateTable
CREATE TABLE "gl_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "entry_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "source_ref" TEXT,
    "posted_by" TEXT,
    "posted_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "agent_reviewed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "journal_entry_id" TEXT NOT NULL,
    "gl_account_id" TEXT NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gl_accounts_tenant_id_idx" ON "gl_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "gl_accounts_tenant_id_code_key" ON "gl_accounts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_idx" ON "journal_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_status_idx" ON "journal_entries"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_source_ref_idx" ON "journal_entries"("tenant_id", "source_ref");

-- CreateIndex
CREATE INDEX "journal_lines_journal_entry_id_idx" ON "journal_lines"("journal_entry_id");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- === eom-service ===
-- CreateTable
CREATE TABLE "eom_closes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "current_step" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "blocked_reason" TEXT,

    CONSTRAINT "eom_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eom_steps" (
    "id" TEXT NOT NULL,
    "eom_close_id" TEXT NOT NULL,
    "step_code" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "eom_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "eom_closes_tenant_id_idx" ON "eom_closes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "eom_closes_tenant_id_period_year_period_month_key" ON "eom_closes"("tenant_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "eom_steps_eom_close_id_idx" ON "eom_steps"("eom_close_id");

-- AddForeignKey
ALTER TABLE "eom_steps" ADD CONSTRAINT "eom_steps_eom_close_id_fkey" FOREIGN KEY ("eom_close_id") REFERENCES "eom_closes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- === payroll-service ===
-- CreateTable
CREATE TABLE "payroll_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "batch_ref" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "posted_at" TIMESTAMP(3),
    "held_reason" TEXT,

    CONSTRAINT "payroll_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_batches_tenant_id_idx" ON "payroll_batches"("tenant_id");

-- CreateIndex
CREATE INDEX "payroll_batches_tenant_id_status_idx" ON "payroll_batches"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_batches_tenant_id_idempotency_key_key" ON "payroll_batches"("tenant_id", "idempotency_key");


-- === apar-service ===
-- CreateTable
CREATE TABLE "ar_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "dealer_ref" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "oem_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "invoice_ref" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "gl_account_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ar_entries_tenant_id_idx" ON "ar_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "ar_entries_tenant_id_status_idx" ON "ar_entries"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "ap_entries_tenant_id_idx" ON "ap_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "ap_entries_tenant_id_status_idx" ON "ap_entries"("tenant_id", "status");


-- === recon-service ===
-- CreateTable
CREATE TABLE "bank_recons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "recon_date" TIMESTAMP(3) NOT NULL,
    "gl_balance" DOUBLE PRECISION NOT NULL,
    "bank_balance" DOUBLE PRECISION NOT NULL,
    "variance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),

    CONSTRAINT "bank_recons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "bank_recon_id" TEXT NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "matched_journal_line_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_recons_tenant_id_idx" ON "bank_recons"("tenant_id");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_recon_id_idx" ON "bank_transactions"("bank_recon_id");

-- CreateIndex
CREATE INDEX "bank_transactions_bank_recon_id_status_idx" ON "bank_transactions"("bank_recon_id", "status");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_recon_id_fkey" FOREIGN KEY ("bank_recon_id") REFERENCES "bank_recons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- === audit-service ===
-- CreateTable
CREATE TABLE "agent_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent_name" TEXT NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "input_summary" TEXT NOT NULL,
    "action_taken" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "human_required" BOOLEAN NOT NULL DEFAULT false,
    "human_resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_logs_tenant_id_idx" ON "agent_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "agent_logs_tenant_id_agent_name_idx" ON "agent_logs"("tenant_id", "agent_name");

-- CreateIndex
CREATE INDEX "agent_logs_human_required_idx" ON "agent_logs"("human_required");




-- Runtime stabilization: recon-service (WF-A004 Bank Reconciliation) had a
-- Prisma schema.prisma but no prisma/migrations directory at all — it was
-- never migrated, so bank_recons/bank_transactions did not exist and
-- GET /api/v1/recon failed with Prisma P2021 ("table does not exist").
-- This is the missing baseline, generated via
-- `prisma migrate diff --from-empty --to-schema-datamodel`.

-- CreateTable
CREATE TABLE "bank_recons" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "recon_date" TIMESTAMP(3) NOT NULL,
    "gl_balance" DECIMAL(15,2) NOT NULL,
    "bank_balance" DECIMAL(15,2) NOT NULL,
    "variance" DECIMAL(15,2) NOT NULL DEFAULT 0,
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
    "amount" DECIMAL(15,2) NOT NULL,
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


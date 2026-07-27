-- BUILD-003: GL Distribution Accounts (COBOL GL-TYPE='%' equivalent)
-- NOTE: Run outside a transaction if using Prisma migrate; ALTER TYPE ADD VALUE cannot run inside a transaction in PostgreSQL < 12.

-- Add DISTRIBUTION to the account type enum
-- (gl_accounts.type is currently stored as TEXT, so this migration only creates the new table)
-- If a gl_account_type enum exists in the DB, uncomment the line below:
-- ALTER TYPE gl_account_type ADD VALUE IF NOT EXISTS 'DISTRIBUTION';

-- Distribution table: one source account → many target accounts by percentage
-- @cobol-origin getgldistr.cbl — supports up to 90 sub-accounts per distribution account
CREATE TABLE IF NOT EXISTS gl_distributions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  source_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
  target_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
  percentage NUMERIC(5,2) NOT NULL CHECK (percentage > 0 AND percentage <= 100),
  sort_order SMALLINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, source_account_id, target_account_id)
);

CREATE INDEX IF NOT EXISTS idx_gl_distributions_source ON gl_distributions(tenant_id, source_account_id);
CREATE INDEX IF NOT EXISTS idx_gl_distributions_target ON gl_distributions(tenant_id, target_account_id);

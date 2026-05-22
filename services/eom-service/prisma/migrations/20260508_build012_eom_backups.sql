-- BUILD-012: Pre-purge snapshot for disaster recovery

CREATE TABLE eom_backups (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  eom_close_id TEXT NOT NULL,
  backup_type VARCHAR(20) NOT NULL CHECK (backup_type IN ('GL_ACCOUNTS', 'PERIOD_BALANCES')),
  backup_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_eom_backups_close ON eom_backups(eom_close_id);
CREATE INDEX idx_eom_backups_tenant ON eom_backups(tenant_id);

-- BUILD-007: GLBYID Account ID Mapping Table
-- @cobol-origin GLBYID-FILE — external account ID to GL number mapping
-- @use-case Dealer group consolidations, DMS migrations, external system integrations

CREATE TABLE gl_account_id_map (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  external_account_id VARCHAR(5) NOT NULL,
  gl_account_id TEXT NOT NULL REFERENCES gl_accounts(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, external_account_id)
);

CREATE INDEX idx_gl_account_id_map_gl
  ON gl_account_id_map(tenant_id, gl_account_id);

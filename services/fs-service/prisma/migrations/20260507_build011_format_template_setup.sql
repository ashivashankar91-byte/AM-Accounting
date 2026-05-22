-- BUILD-011: Financial Statement Configuration Management

CREATE TABLE format_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mfg_code VARCHAR(20) NOT NULL,
  format_name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, mfg_code)
);

CREATE INDEX idx_format_codes_tenant_active ON format_codes(tenant_id, is_active);

CREATE TABLE fs_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mfg_code VARCHAR(20) NOT NULL,
  year INTEGER NOT NULL,
  parameters JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, mfg_code, year)
);

CREATE INDEX idx_fs_templates_mfg ON fs_templates(tenant_id, mfg_code);

CREATE TABLE fs_setup (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  mfg_code VARCHAR(20) NOT NULL,
  year INTEGER NOT NULL,
  calendar_or_fiscal VARCHAR(20) DEFAULT 'FISCAL',
  statement_option VARCHAR(255),
  transmission_group VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, mfg_code, year)
);

CREATE INDEX idx_fs_setup_mfg ON fs_setup(tenant_id, mfg_code);

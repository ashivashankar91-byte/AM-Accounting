CREATE TABLE gl_sources (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  source_code VARCHAR(2) NOT NULL,
  name TEXT NOT NULL,
  is_clearing_account BOOLEAN DEFAULT false,
  is_year_end_reserved BOOLEAN DEFAULT false,
  is_13th_month_reserved BOOLEAN DEFAULT false,
  balance_method CHAR(1) DEFAULT ' ',
  auto_post BOOLEAN DEFAULT false,
  add_units BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, source_code)
);

CREATE TABLE journal_source_permissions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES gl_sources(id) ON DELETE CASCADE,
  has_access BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, user_id, source_id)
);

CREATE INDEX idx_gl_sources_tenant ON gl_sources(tenant_id);
CREATE INDEX idx_journal_source_perms_tenant_user ON journal_source_permissions(tenant_id, user_id);

-- Seed standard source codes for any future tenant setup
-- (Not seeded here as tenant_id is required — use PUT API to seed per-tenant)
-- Standard codes: GL, PR, AP, AR, SR, 09 (year-end reserved), 88 (13th month reserved)

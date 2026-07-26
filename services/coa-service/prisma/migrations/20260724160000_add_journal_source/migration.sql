-- S212 Journal Source Registry
-- New coa-service-owned registry of journal origin codes (manual GJ + reserved
-- system sources). Legacy gl-service `gl_sources` (numeric, tenant-scoped)
-- coexists — consolidation is an integration-gate concern (S210/S010 precedent).
-- Additive only.

CREATE TABLE IF NOT EXISTS journal_source (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  code           VARCHAR(6) NOT NULL,
  numeric_alias  INT,                          -- reserved column pending UQ-13
  name           VARCHAR(120) NOT NULL,
  source_class   TEXT NOT NULL,                -- MANUAL | SYSTEM
  reserved       BOOLEAN NOT NULL DEFAULT false,
  auto_post      BOOLEAN NOT NULL DEFAULT false,
  year_end_only  BOOLEAN NOT NULL DEFAULT false,
  thirteenth_only BOOLEAN NOT NULL DEFAULT false,
  status         TEXT NOT NULL DEFAULT 'ACTIVE',
  version        INT  NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT journal_source_code_fmt CHECK (code ~ '^[A-Z0-9]{2,6}$'),
  CONSTRAINT journal_source_class_chk CHECK (source_class IN ('MANUAL','SYSTEM')),
  CONSTRAINT journal_source_status_chk CHECK (status IN ('ACTIVE','INACTIVE')),
  CONSTRAINT journal_source_tenant_code_uq UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_journal_source_tenant_class
  ON journal_source(tenant_id, source_class, status);

SELECT '---APPLIED---' AS status;

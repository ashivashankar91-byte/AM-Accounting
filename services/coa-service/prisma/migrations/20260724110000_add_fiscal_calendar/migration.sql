-- S208 Fiscal Calendar Definition — additive migration (no destructive DDL).
-- Per-legal-entity fiscal calendar + generated periods. Refactors the
-- eom-service prototype (fiscal_periods, tenant-scoped) into a governed
-- per-entity owner. IF NOT EXISTS keeps this idempotent across environments.

-- One calendar per legal entity (BR208-1).
CREATE TABLE IF NOT EXISTS fiscal_calendar (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id      TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  fy_start_month SMALLINT NOT NULL CHECK (fy_start_month BETWEEN 1 AND 12),
  structure      VARCHAR(20) NOT NULL CHECK (structure IN ('TWELVE', 'TWELVE_PLUS_13TH')),
  status         VARCHAR(16) NOT NULL DEFAULT 'DEFINED' CHECK (status IN ('DEFINED', 'LOCKED')),
  actor          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at      TIMESTAMPTZ
);

-- BR208-1: exactly one calendar per entity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_calendar_entity
  ON fiscal_calendar(entity_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_calendar_tenant
  ON fiscal_calendar(tenant_id);

-- Generated periods. Created FUTURE (BR208-2); S209 owns further transitions.
CREATE TABLE IF NOT EXISTS fiscal_period (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id        TEXT NOT NULL,
  entity_id        TEXT NOT NULL,
  calendar_id      TEXT NOT NULL REFERENCES fiscal_calendar(id),
  fiscal_year      INTEGER NOT NULL,
  period_number    SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 13),
  code             VARCHAR(8) NOT NULL,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  status           VARCHAR(16) NOT NULL DEFAULT 'FUTURE',
  adjustments_only BOOLEAN NOT NULL DEFAULT false,
  has_postings     BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deterministic identity: one period per code and per (year, number) per entity.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_period_entity_code
  ON fiscal_period(entity_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_period_entity_year_num
  ON fiscal_period(entity_id, fiscal_year, period_number);
CREATE INDEX IF NOT EXISTS idx_fiscal_period_tenant_entity_year
  ON fiscal_period(tenant_id, entity_id, fiscal_year);
-- BR208-5: date->period resolution scans by date range within an entity.
CREATE INDEX IF NOT EXISTS idx_fiscal_period_resolve
  ON fiscal_period(entity_id, start_date, end_date);

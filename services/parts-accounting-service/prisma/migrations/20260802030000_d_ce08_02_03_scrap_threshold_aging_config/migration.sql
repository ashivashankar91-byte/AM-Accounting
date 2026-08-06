-- Integration-only fix: D-CE08-02 scrap threshold config and D-CE08-03 aging band config.
-- Additive migration — no existing rows are modified.

-- ── D-CE08-02: Scrap threshold config ────────────────────────────────────────
-- Tenant/legal-entity-scoped, effective-dated. When no row is active the
-- scrap endpoint refuses with SCRAP_THRESHOLD_NOT_CONFIGURED; no global
-- default is ever invented. Safe to deploy against existing data.

CREATE TABLE scrap_threshold_config (
  id               UUID         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        TEXT         NOT NULL,
  legal_entity_id  TEXT         NOT NULL,
  threshold_amount NUMERIC(15,2) NOT NULL,
  effective_from   DATE         NOT NULL,
  created_by       TEXT         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT scrap_threshold_config_pkey PRIMARY KEY (id),
  CONSTRAINT scrap_threshold_config_positive CHECK (threshold_amount > 0)
);

CREATE UNIQUE INDEX scrap_threshold_config_unique_eff
  ON scrap_threshold_config (tenant_id, legal_entity_id, effective_from);

CREATE INDEX scrap_threshold_config_tenant_entity
  ON scrap_threshold_config (tenant_id, legal_entity_id, effective_from DESC);

-- RLS: each service connection inherits the tenant context set by rls-middleware.
ALTER TABLE scrap_threshold_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY scrap_threshold_config_tenant_isolation
  ON scrap_threshold_config
  USING (tenant_id = current_setting('app.current_tenant_id', true));

-- ── D-CE08-03: Aging band config ──────────────────────────────────────────────
-- Tenant/legal-entity-scoped, effective-dated. bandConfig stores an ordered
-- array of { label, minDays, maxDays, provisionPct }. When no row is active
-- the obsolescence preview refuses with AGING_BAND_CONFIG_NOT_CONFIGURED; no
-- default set is invented server-side.

CREATE TABLE obsolescence_aging_band_config (
  id               UUID         NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        TEXT         NOT NULL,
  legal_entity_id  TEXT         NOT NULL,
  band_config      JSONB        NOT NULL,
  effective_from   DATE         NOT NULL,
  created_by       TEXT         NOT NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT obsolescence_aging_band_config_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX obsolescence_aging_band_config_unique_eff
  ON obsolescence_aging_band_config (tenant_id, legal_entity_id, effective_from);

CREATE INDEX obsolescence_aging_band_config_tenant_entity
  ON obsolescence_aging_band_config (tenant_id, legal_entity_id, effective_from DESC);

ALTER TABLE obsolescence_aging_band_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY obsolescence_aging_band_config_tenant_isolation
  ON obsolescence_aging_band_config
  USING (tenant_id = current_setting('app.current_tenant_id', true));

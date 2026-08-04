-- S005: Add idempotency key, legalEntityId, status and retry fields
-- to hr_provisioning_events so every event can be deduplicated by
-- the external correlation ID the HR system sends.

ALTER TABLE hr_provisioning_events
  ADD COLUMN IF NOT EXISTS source_correlation_id  TEXT,
  ADD COLUMN IF NOT EXISTS legal_entity_id        TEXT,
  ADD COLUMN IF NOT EXISTS status                 TEXT NOT NULL DEFAULT 'PROCESSED',
  ADD COLUMN IF NOT EXISTS retry_count            INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at        TIMESTAMPTZ;

-- Unique index on source_correlation_id per tenant so duplicates are refused
-- at the DB level as a safety net.  NULLs are excluded (legacy rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_prov_source_corr
  ON hr_provisioning_events (tenant_id, source_correlation_id)
  WHERE source_correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hr_prov_legal_entity ON hr_provisioning_events(legal_entity_id);
CREATE INDEX IF NOT EXISTS idx_hr_prov_status       ON hr_provisioning_events(status);

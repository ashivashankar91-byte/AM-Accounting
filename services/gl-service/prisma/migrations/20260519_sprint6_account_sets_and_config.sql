-- Sprint 6: GL Account Sets and Reversal Notes Config
-- S6-04: GL Account Sets for grouped balance reporting
-- S6-05: force_reversal_notes_required system config flag

CREATE TABLE IF NOT EXISTS gl_account_sets (
  id          UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   TEXT        NOT NULL,
  set_name    VARCHAR(50) NOT NULL,
  description TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_gl_account_set UNIQUE (tenant_id, set_name)
);

CREATE TABLE IF NOT EXISTS gl_account_set_members (
  id            UUID      NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  set_id        UUID      NOT NULL REFERENCES gl_account_sets(id) ON DELETE CASCADE,
  gl_account_id TEXT      NOT NULL,
  sort_order    SMALLINT  NOT NULL DEFAULT 0,
  CONSTRAINT uq_set_account UNIQUE (set_id, gl_account_id)
);

-- S6-05: Force reversal notes system config
ALTER TABLE gl_system_config
  ADD COLUMN IF NOT EXISTS force_reversal_notes_required BOOLEAN NOT NULL DEFAULT FALSE;

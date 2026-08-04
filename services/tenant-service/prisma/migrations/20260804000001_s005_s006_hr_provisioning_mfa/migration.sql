-- S005: HR-Event Provisioning Hooks
-- Persists every HR event that triggered an accounting role change, providing
-- full audit lineage from HR system to accounting user provisioning.

CREATE TABLE IF NOT EXISTS hr_provisioning_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  hr_event_type   TEXT NOT NULL,  -- HR_USER_CREATED | HR_USER_TERMINATED | HR_USER_ROLE_CHANGED
  hr_user_id      TEXT NOT NULL,
  hr_system       TEXT NOT NULL,  -- source HR system identifier
  payload         JSONB NOT NULL DEFAULT '{}',
  accounting_action TEXT NOT NULL, -- PROVISIONED | DEPROVISIONED | ROLE_UPDATED | IGNORED
  accounting_user_id TEXT,
  accounting_roles TEXT[],
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message   TEXT,
  correlation_id  TEXT NOT NULL DEFAULT gen_random_uuid()::text
);

CREATE INDEX idx_hr_prov_tenant ON hr_provisioning_events(tenant_id);
CREATE INDEX idx_hr_prov_user ON hr_provisioning_events(hr_user_id);
CREATE INDEX idx_hr_prov_type ON hr_provisioning_events(hr_event_type);

-- S005: RLS — tenants see only their own HR provisioning events
ALTER TABLE hr_provisioning_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_prov_tenant_isolation ON hr_provisioning_events
  USING (tenant_id = current_setting('app.tenant_id', true));

-- S006: MFA & Safeguards Evidence
-- MFA enforcement policies per tenant (configurable enforcement level).

CREATE TABLE IF NOT EXISTS mfa_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL UNIQUE,
  enforcement     TEXT NOT NULL DEFAULT 'OPTIONAL', -- OPTIONAL | REQUIRED_FOR_FINANCE | REQUIRED_ALL
  totp_enabled    BOOLEAN NOT NULL DEFAULT true,
  sms_enabled     BOOLEAN NOT NULL DEFAULT false,
  exempt_roles    TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mfa_policy_tenant ON mfa_policies(tenant_id);
ALTER TABLE mfa_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY mfa_policy_tenant_isolation ON mfa_policies
  USING (tenant_id = current_setting('app.tenant_id', true));

-- S006: Safeguards evidence — immutable record of every MFA authentication event
CREATE TABLE IF NOT EXISTS safeguards_evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  event_type      TEXT NOT NULL, -- MFA_VERIFIED | MFA_FAILED | MFA_BYPASS_GRANTED | MFA_ENROLLED | MFA_RESET
  mfa_method      TEXT,          -- TOTP | SMS | DEMO_FIXTURE
  resource_type   TEXT,          -- the resource being accessed (e.g. JOURNAL_ENTRY, PERIOD_CLOSE)
  resource_id     TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  evidence_hash   TEXT,          -- SHA-256 of (user_id || event_type || timestamp) for tamper detection
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id      TEXT,
  correlation_id  TEXT NOT NULL DEFAULT gen_random_uuid()::text
);

CREATE INDEX idx_safeguards_tenant ON safeguards_evidence(tenant_id);
CREATE INDEX idx_safeguards_user ON safeguards_evidence(user_id);
CREATE INDEX idx_safeguards_event ON safeguards_evidence(event_type);
CREATE INDEX idx_safeguards_occurred ON safeguards_evidence(occurred_at);

-- Safeguards evidence is immutable — no UPDATE/DELETE allowed
ALTER TABLE safeguards_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY safeguards_evidence_tenant_read ON safeguards_evidence
  FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true));
-- No write policy through app role — inserts go through OWNER connection only

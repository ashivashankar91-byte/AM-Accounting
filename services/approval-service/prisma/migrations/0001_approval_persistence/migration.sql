CREATE TABLE approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT NOT NULL,
  legal_entity_id TEXT,
  agent_name      TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  entity_ref      TEXT NOT NULL,
  reasoning       TEXT NOT NULL,
  evidence        JSONB NOT NULL DEFAULT '[]',
  required_role   TEXT NOT NULL,
  requester_id    TEXT,
  eligible_approvers JSONB NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'PENDING',
  decided_by      TEXT,
  decision_note   TEXT,
  proposed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL,
  decided_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  source_action   TEXT,
  idempotency_key TEXT UNIQUE,
  version         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX approval_requests_tenant_status ON approval_requests (tenant_id, status);
CREATE INDEX approval_requests_tenant_le ON approval_requests (tenant_id, legal_entity_id);

CREATE TABLE approval_decision_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES approval_requests(id),
  actor_id    TEXT NOT NULL,
  decision    TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_decision_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_requests_tenant ON approval_requests
  USING (tenant_id = current_setting('app.tenant_id', true));
CREATE POLICY approval_history_tenant ON approval_decision_history
  USING (request_id IN (SELECT id FROM approval_requests WHERE tenant_id = current_setting('app.tenant_id', true)));

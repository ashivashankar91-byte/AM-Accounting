-- S095 — Portfolio Reserve Accrual (additive migration)
CREATE TABLE portfolio_reserve_config (
  id               TEXT PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id        TEXT NOT NULL,
  legal_entity_id  TEXT NOT NULL,
  portfolio_code   TEXT NOT NULL,
  accrual_basis_bp INTEGER NOT NULL,
  effective_from   TIMESTAMP(3) NOT NULL,
  effective_to     TIMESTAMP(3),
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_prc_tenant_entity_code ON portfolio_reserve_config(tenant_id, legal_entity_id, portfolio_code);

CREATE TABLE portfolio_reserve_accrual (
  id                TEXT PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::TEXT,
  tenant_id         TEXT NOT NULL,
  legal_entity_id   TEXT NOT NULL,
  portfolio_code    TEXT NOT NULL,
  config_id         TEXT NOT NULL REFERENCES portfolio_reserve_config(id),
  period_year       INTEGER NOT NULL,
  period_month      INTEGER NOT NULL,
  portfolio_balance NUMERIC(15,2) NOT NULL,
  accrual_amount    NUMERIC(15,2) NOT NULL,
  idempotency_key   TEXT NOT NULL,
  posted_journal_id TEXT,
  actor             TEXT NOT NULL,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_pra_idempotency UNIQUE(tenant_id, idempotency_key)
);
CREATE INDEX idx_pra_tenant_entity_code_period ON portfolio_reserve_accrual(tenant_id, legal_entity_id, portfolio_code, period_year, period_month);

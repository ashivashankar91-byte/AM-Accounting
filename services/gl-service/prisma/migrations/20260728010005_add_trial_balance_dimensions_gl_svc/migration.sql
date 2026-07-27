-- S014 Trial Balance API.
-- The legacy gl-service projection table aggregated period balances only by
-- (tenant, account, period, source). That made entity/store/department trial
-- balance slices impossible to prove or rebuild, because journal_lines carried
-- the slice dimensions but GLAccountPeriodBalance did not.
--
-- Additive fix:
--   1. Persist store_id on journal_lines (company_code and department_code
--      already exist).
--   2. Persist company/store/department dimensions on
--      gl_account_period_balances.
--   3. Replace the old unique key with the dimension-aware key needed for
--      correct projection updates per slice.

ALTER TABLE journal_lines
  ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT '';

ALTER TABLE gl_account_period_balances
  ADD COLUMN IF NOT EXISTS company_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS store_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS department_code TEXT NOT NULL DEFAULT '';

ALTER TABLE gl_account_period_balances
  DROP CONSTRAINT IF EXISTS gl_account_period_balances_tenant_id_gl_account_id_period_year_period_month_journal_source_key;

ALTER TABLE gl_account_period_balances
  ADD CONSTRAINT gl_account_period_balances_tb_slice_key
  UNIQUE (tenant_id, gl_account_id, period_year, period_month, journal_source, company_code, store_id, department_code);

CREATE INDEX IF NOT EXISTS gl_account_period_balances_tb_slice_idx
  ON gl_account_period_balances (tenant_id, company_code, store_id, department_code, period_year, period_month);


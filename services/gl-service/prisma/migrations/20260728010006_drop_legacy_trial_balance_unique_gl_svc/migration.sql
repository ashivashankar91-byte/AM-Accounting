-- S014 follow-up: the original Prisma-created unique index on
-- (tenant_id, gl_account_id, period_year, period_month, journal_source) uses a
-- truncated auto-generated name, so dropping only the long-form constraint name
-- in 20260728010005 left the legacy uniqueness active. That silently blocked the
-- new per-slice projection rows. Remove the legacy unique index explicitly.

DROP INDEX IF EXISTS gl_account_period_balances_tenant_id_gl_account_id_period_y_key;


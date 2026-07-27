-- Drop the compatibility-only placeholder tables created solely so the legacy
-- FIX-001 migration can run from an empty database. These are NOT gl-service
-- owned tables and must not remain in the final schema when the owning
-- services are not yet onboarded.

DROP TABLE IF EXISTS "payroll_batches";
DROP TABLE IF EXISTS "payroll_lines";
DROP TABLE IF EXISTS "ar_entries";
DROP TABLE IF EXISTS "ap_entries";
DROP TABLE IF EXISTS "cashflow_forecasts";
DROP TABLE IF EXISTS "daily_cash_actuals";
DROP TABLE IF EXISTS "bank_recons";
DROP TABLE IF EXISTS "bank_transactions";
DROP TABLE IF EXISTS "revenue_contracts";
DROP TABLE IF EXISTS "revenue_schedule_lines";
DROP TABLE IF EXISTS "agg_monthly_pl";
DROP TABLE IF EXISTS "agg_parts_margin";
DROP TABLE IF EXISTS "agg_tech_productivity";
DROP TABLE IF EXISTS "documents";

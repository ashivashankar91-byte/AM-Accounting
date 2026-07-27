-- Compatibility shim for the legacy FIX-001 migration.
--
-- The historical 20260507010000_fix001_double_precision_to_numeric SQL reaches
-- across tables now owned by services that have NOT yet been onboarded into the
-- Prisma migration stack in this repository (payroll/ap-ar/recon/revenue/
-- analytics/document services). On an empty database, FIX-001 aborts before it
-- can finish the actual gl-service column conversions because those foreign
-- tables do not exist yet.
--
-- To keep the original FIX-001 bytes untouched (PO instruction) while still
-- making `prisma migrate deploy` reproducible from zero, this shim creates the
-- minimal placeholder tables/columns FIX-001 needs to alter. The follow-up
-- migration 20260507010001 immediately drops these placeholders again, so the
-- final post-deploy schema is not polluted with invented cross-service tables.
-- Live/shared databases that later gain real owning-service migrations remain
-- unaffected because every CREATE/DROP here is IF [NOT] EXISTS guarded.

CREATE TABLE IF NOT EXISTS "payroll_batches" ("total_amount" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "payroll_lines" ("rate" DOUBLE PRECISION, "amount" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "ar_entries" ("amount" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "ap_entries" ("amount" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "cashflow_forecasts" ("predicted_balance" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "daily_cash_actuals" ("balance" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "bank_recons" (
  "gl_balance" DOUBLE PRECISION,
  "bank_balance" DOUBLE PRECISION,
  "variance" DOUBLE PRECISION
);
CREATE TABLE IF NOT EXISTS "bank_transactions" ("amount" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "revenue_contracts" ("total_value" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "revenue_schedule_lines" (
  "scheduled_amount" DOUBLE PRECISION,
  "recognised_amount" DOUBLE PRECISION
);
CREATE TABLE IF NOT EXISTS "agg_monthly_pl" (
  "revenue" DOUBLE PRECISION,
  "cost_of_sales" DOUBLE PRECISION,
  "gross_profit" DOUBLE PRECISION,
  "expenses" DOUBLE PRECISION,
  "net_income" DOUBLE PRECISION
);
CREATE TABLE IF NOT EXISTS "agg_parts_margin" (
  "total_revenue" DOUBLE PRECISION,
  "total_cost" DOUBLE PRECISION,
  "gross_margin" DOUBLE PRECISION
);
CREATE TABLE IF NOT EXISTS "agg_tech_productivity" ("total_labour_revenue" DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS "documents" ("total_amount" DOUBLE PRECISION);

-- =============================================================================
-- FIX-001: DOUBLE PRECISION → NUMERIC for all monetary columns
-- =============================================================================
-- Rationale: IEEE 754 DOUBLE PRECISION causes silent rounding errors on
-- financial calculations (e.g., 0.1 + 0.2 = 0.30000000000000004).
-- The legacy COBOL system used COMP-3 packed decimal (exact arithmetic).
-- NUMERIC(15,2) provides exact decimal arithmetic required for financial data.
-- rate columns use NUMERIC(15,4) to preserve sub-cent precision (e.g., hourly pay rates).
-- =============================================================================

BEGIN;

-- ── gl-service: journal_lines ────────────────────────────────────────────────
ALTER TABLE "journal_lines" ALTER COLUMN "debit"  TYPE NUMERIC(15,2) USING "debit"::NUMERIC(15,2);
ALTER TABLE "journal_lines" ALTER COLUMN "credit" TYPE NUMERIC(15,2) USING "credit"::NUMERIC(15,2);

-- ── gl-service: deal_product_lines ──────────────────────────────────────────
ALTER TABLE "deal_product_lines" ALTER COLUMN "sale_price"   TYPE NUMERIC(15,2) USING "sale_price"::NUMERIC(15,2);
ALTER TABLE "deal_product_lines" ALTER COLUMN "dealer_cost"  TYPE NUMERIC(15,2) USING "dealer_cost"::NUMERIC(15,2);
ALTER TABLE "deal_product_lines" ALTER COLUMN "gross_profit" TYPE NUMERIC(15,2) USING "gross_profit"::NUMERIC(15,2);

-- ── gl-service: intercompany_entries ────────────────────────────────────────
ALTER TABLE "intercompany_entries" ALTER COLUMN "amount" TYPE NUMERIC(15,2) USING "amount"::NUMERIC(15,2);

-- ── payroll-service: payroll_batches ────────────────────────────────────────
ALTER TABLE "payroll_batches" ALTER COLUMN "total_amount" TYPE NUMERIC(15,2) USING "total_amount"::NUMERIC(15,2);

-- ── payroll-service: payroll_lines ──────────────────────────────────────────
-- rate: NUMERIC(15,4) — needs 4 decimal places for sub-cent pay rates
ALTER TABLE "payroll_lines" ALTER COLUMN "rate"   TYPE NUMERIC(15,4) USING "rate"::NUMERIC(15,4);
ALTER TABLE "payroll_lines" ALTER COLUMN "amount" TYPE NUMERIC(15,2) USING "amount"::NUMERIC(15,2);

-- ── apar-service: ar_entries ─────────────────────────────────────────────────
ALTER TABLE "ar_entries" ALTER COLUMN "amount" TYPE NUMERIC(15,2) USING "amount"::NUMERIC(15,2);

-- ── apar-service: ap_entries ─────────────────────────────────────────────────
ALTER TABLE "ap_entries" ALTER COLUMN "amount" TYPE NUMERIC(15,2) USING "amount"::NUMERIC(15,2);

-- ── cashflow-service: cashflow_forecasts ────────────────────────────────────
ALTER TABLE "cashflow_forecasts" ALTER COLUMN "predicted_balance" TYPE NUMERIC(15,2) USING "predicted_balance"::NUMERIC(15,2);

-- ── cashflow-service: daily_cash_actuals ────────────────────────────────────
ALTER TABLE "daily_cash_actuals" ALTER COLUMN "balance" TYPE NUMERIC(15,2) USING "balance"::NUMERIC(15,2);

-- ── recon-service: bank_recons ───────────────────────────────────────────────
ALTER TABLE "bank_recons" ALTER COLUMN "gl_balance"   TYPE NUMERIC(15,2) USING "gl_balance"::NUMERIC(15,2);
ALTER TABLE "bank_recons" ALTER COLUMN "bank_balance" TYPE NUMERIC(15,2) USING "bank_balance"::NUMERIC(15,2);
ALTER TABLE "bank_recons" ALTER COLUMN "variance"     TYPE NUMERIC(15,2) USING "variance"::NUMERIC(15,2);

-- ── recon-service: bank_transactions ────────────────────────────────────────
ALTER TABLE "bank_transactions" ALTER COLUMN "amount" TYPE NUMERIC(15,2) USING "amount"::NUMERIC(15,2);

-- ── revenue-service: revenue_contracts ──────────────────────────────────────
ALTER TABLE "revenue_contracts" ALTER COLUMN "total_value" TYPE NUMERIC(15,2) USING "total_value"::NUMERIC(15,2);

-- ── revenue-service: revenue_schedule_lines ─────────────────────────────────
ALTER TABLE "revenue_schedule_lines" ALTER COLUMN "scheduled_amount"  TYPE NUMERIC(15,2) USING "scheduled_amount"::NUMERIC(15,2);
ALTER TABLE "revenue_schedule_lines" ALTER COLUMN "recognised_amount" TYPE NUMERIC(15,2) USING "recognised_amount"::NUMERIC(15,2);

-- ── analytics-service: agg_monthly_pl ───────────────────────────────────────
ALTER TABLE "agg_monthly_pl" ALTER COLUMN "revenue"       TYPE NUMERIC(15,2) USING "revenue"::NUMERIC(15,2);
ALTER TABLE "agg_monthly_pl" ALTER COLUMN "cost_of_sales" TYPE NUMERIC(15,2) USING "cost_of_sales"::NUMERIC(15,2);
ALTER TABLE "agg_monthly_pl" ALTER COLUMN "gross_profit"  TYPE NUMERIC(15,2) USING "gross_profit"::NUMERIC(15,2);
ALTER TABLE "agg_monthly_pl" ALTER COLUMN "expenses"      TYPE NUMERIC(15,2) USING "expenses"::NUMERIC(15,2);
ALTER TABLE "agg_monthly_pl" ALTER COLUMN "net_income"    TYPE NUMERIC(15,2) USING "net_income"::NUMERIC(15,2);

-- ── analytics-service: agg_parts_margin ─────────────────────────────────────
-- total_revenue and total_cost are monetary; gross_margin is monetary; gross_margin_pct is a ratio (left as-is)
ALTER TABLE "agg_parts_margin" ALTER COLUMN "total_revenue" TYPE NUMERIC(15,2) USING "total_revenue"::NUMERIC(15,2);
ALTER TABLE "agg_parts_margin" ALTER COLUMN "total_cost"    TYPE NUMERIC(15,2) USING "total_cost"::NUMERIC(15,2);
ALTER TABLE "agg_parts_margin" ALTER COLUMN "gross_margin"  TYPE NUMERIC(15,2) USING "gross_margin"::NUMERIC(15,2);

-- ── analytics-service: agg_tech_productivity ────────────────────────────────
-- total_labour_revenue is monetary; total_flat_rate and total_clock are time values (left as-is)
ALTER TABLE "agg_tech_productivity" ALTER COLUMN "total_labour_revenue" TYPE NUMERIC(15,2) USING "total_labour_revenue"::NUMERIC(15,2);

-- ── document-service: documents ──────────────────────────────────────────────
ALTER TABLE "documents" ALTER COLUMN "total_amount" TYPE NUMERIC(15,2) USING "total_amount"::NUMERIC(15,2);

COMMIT;

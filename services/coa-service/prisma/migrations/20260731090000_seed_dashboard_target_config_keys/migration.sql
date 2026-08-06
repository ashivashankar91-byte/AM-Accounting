-- ════════════════════════════════════════════════════════════════════════════
-- Dashboard rebuild — target/benchmark configuration keys (CE-?? AMACC 2.0
-- accounting dashboards: Command Center / Financial Dashboard / Group
-- Dashboard).
--
-- The dashboard rebuild brief is explicit: "No hardcoded targets or
-- benchmarks... Every threshold reads from a per-tenant, per-entity,
-- optionally per-OEM configuration table. Ship sensible defaults; never
-- bake them into components." This migration registers those keys in the
-- existing generic config framework (S223 — config_key_catalog /
-- config_setting) rather than inventing a new mechanism. All keys default
-- at TENANT scope and may be overridden at ENTITY or STORE scope per the
-- existing STORE -> ENTITY -> TENANT -> default resolution order.
--
-- Decimal-valued targets (ratios, percentages) are stored as STRING and
-- parsed as float by the frontend metrics/targets module — the config
-- framework's typed value set (BOOL | INT | ENUM | STRING) has no DECIMAL
-- type; STRING is the established pattern for anything the framework
-- doesn't natively type (see fiscal.max_open_periods for the INT
-- precedent, je.posting_mode for the ENUM precedent).
--
-- Additive migration only. Idempotent (ON CONFLICT DO NOTHING).
-- ════════════════════════════════════════════════════════════════════════════

INSERT INTO "config_key_catalog"
  ("key", "type", "allowed_scope", "enum_values", "default_value", "description", "since_version")
VALUES
  -- Absorption rate: Fixed ops gross (Service+Parts+Body) / total overhead.
  ('dashboard.absorption_target', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '0.85', 'Target absorption rate (ratio, e.g. 0.85 = 85%) for Financial Dashboard expense-discipline panel and Group Dashboard ranking.', '1.0.0'),
  ('dashboard.absorption_include_fi_gross', 'BOOL', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   'false', 'Whether F&I gross is included in the absorption-rate numerator. Default excludes F&I per brief default.', '1.0.0'),
  ('dashboard.absorption_overhead_basis', 'ENUM', ARRAY['TENANT','ENTITY'], ARRAY['total','adjusted'],
   'total', 'Whether the absorption-rate denominator is total dealership overhead or an adjusted-overhead figure.', '1.0.0'),

  -- Expense discipline panel targets.
  ('dashboard.expense_to_gross_target', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '0.75', 'Target expense-to-gross ratio (total expenses / total gross), departmental and total variants.', '1.0.0'),
  ('dashboard.gross_to_net_target', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '0.20', 'Target gross-to-net ratio (net profit / total gross).', '1.0.0'),
  ('dashboard.personnel_to_gross_target', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '0.30', 'Target personnel-to-gross ratio (total personnel expense / total gross).', '1.0.0'),

  -- Variable ops targets.
  ('dashboard.front_gross_pur_target_new', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '2000', 'Target front-gross-per-unit-retailed for new vehicles (dollars).', '1.0.0'),
  ('dashboard.front_gross_pur_target_used', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '2200', 'Target front-gross-per-unit-retailed for used vehicles (dollars).', '1.0.0'),
  ('dashboard.fi_pvr_target', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '1500', 'Target F&I gross per retail unit (dollars). F&I is always a dollar figure, never a GP%.', '1.0.0'),

  -- Fixed ops targets.
  ('dashboard.effective_labor_rate_target', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '135', 'Target effective (customer-pay) labor rate (dollars/hour) vs. door rate.', '1.0.0'),
  ('dashboard.hours_per_ro_target', 'STRING', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '2.2', 'Target flagged hours per closed repair order.', '1.0.0'),
  ('dashboard.elr_blended_mode', 'BOOL', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   'false', 'Whether the effective labor rate is blended across CP/warranty/internal (true) or reported per pay-type (false, default).', '1.0.0'),

  -- Days-supply targets (inventory).
  ('dashboard.days_supply_target_new', 'INT', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '60', 'Target days-supply for new-vehicle inventory. Also used as the trailing-N window for the days-supply formula.', '1.0.0'),
  ('dashboard.days_supply_target_used', 'INT', ARRAY['TENANT','ENTITY','STORE'], ARRAY[]::TEXT[],
   '30', 'Target days-supply for used-vehicle inventory. Also used as the trailing-N window for the days-supply formula.', '1.0.0'),

  -- Aging bucket configuration (comma-separated integer boundaries in days
  -- or months; parsed by the frontend metrics/targets module).
  ('dashboard.contracts_in_transit_aging_buckets_days', 'STRING', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '3,5,10,20', 'Comma-separated day boundaries for contracts-in-transit aging buckets.', '1.0.0'),
  ('dashboard.schedule_aging_buckets_days', 'STRING', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '30,60,90', 'Comma-separated day boundaries for aged schedule-item buckets (Command Center).', '1.0.0'),
  ('dashboard.inventory_aging_buckets_days', 'STRING', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '30,60,90,120', 'Comma-separated day boundaries for aged-inventory buckets (Financial Dashboard balance-sheet-health panel).', '1.0.0'),
  ('dashboard.parts_obsolescence_buckets_months', 'STRING', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '6,9,12,24', 'Comma-separated month boundaries for parts-obsolescence buckets.', '1.0.0'),

  -- Command Center exception thresholds.
  ('dashboard.close_days_remaining_warning', 'INT', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '3', 'Days remaining in the close before the header context bar escalates to a warning state.', '1.0.0'),
  ('dashboard.warranty_claim_expiry_warning_days', 'INT', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '8', 'Days before OEM warranty-claim submission-window expiry that a claim surfaces as at-risk.', '1.0.0'),
  ('dashboard.factory_statement_due_warning_days', 'INT', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '5', 'Days before factory-statement submission deadline that the readiness panel escalates to a warning state.', '1.0.0'),

  -- Refresh cadence (brief: "Auto-refresh is opt-in and slow... Default 5
  -- minutes... off by default on the group view").
  ('dashboard.auto_refresh_minutes', 'INT', ARRAY['TENANT','ENTITY'], ARRAY[]::TEXT[],
   '5', 'Default auto-refresh interval in minutes for Command Center / Financial Dashboard. 0 = off.', '1.0.0'),
  ('dashboard.auto_refresh_minutes_group', 'INT', ARRAY['TENANT'], ARRAY[]::TEXT[],
   '0', 'Default auto-refresh interval in minutes for the Group Dashboard. 0 = off by default per brief.', '1.0.0')
ON CONFLICT ("key") DO NOTHING;

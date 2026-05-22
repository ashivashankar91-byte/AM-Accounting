-- Sprint 5 — Floor Plan vehicle identity + cost fields
-- S5-06: Base vehicle classification
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS vehicle_condition VARCHAR(10);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS vehicle_type      VARCHAR(20);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS acquisition_date  DATE;
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS total_cost        NUMERIC(15,2);

-- S5-07: Cost components
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS invoice_cost                 NUMERIC(15,2);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS pack_amount                  NUMERIC(15,2);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS holdback_amount              NUMERIC(15,2);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS factory_rebate               NUMERIC(15,2);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS freight_amount               NUMERIC(15,2);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS prep_charges                 NUMERIC(15,2);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS recon_costs                  NUMERIC(15,2);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS accrued_floor_plan_interest  NUMERIC(15,2) DEFAULT 0;

-- S5-08: Vehicle identity
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS vehicle_year    SMALLINT;
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS vehicle_make    VARCHAR(30);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS vehicle_model   VARCHAR(30);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS vehicle_trim    VARCHAR(30);
ALTER TABLE floor_plan_units ADD COLUMN IF NOT EXISTS vehicle_status  VARCHAR(20) DEFAULT 'IN_STOCK';

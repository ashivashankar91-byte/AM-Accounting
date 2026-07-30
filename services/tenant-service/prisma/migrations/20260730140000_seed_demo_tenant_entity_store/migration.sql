-- Runtime stabilization: deterministic demo bootstrap for tenant-kunes.
-- tenants/legal_entities/stores were reported empty even though gl_accounts,
-- role, user and dealer_group_tenants already reference tenant-kunes /
-- tenant-kunes-ford — this fills in the tenant-service side of that same
-- demo tenant so /entities and /stores are no longer empty for it.
INSERT INTO "tenants" ("id", "name", "dms_type", "dms_api_key", "schema_name", "status", "rooftop_count")
VALUES
  ('tenant-kunes',      'Kunes Chevy Delavan', 'CDK', 'demo-not-a-real-key', 'tenant_kunes',      'ACTIVE', 2),
  ('tenant-kunes-ford', 'Kunes Ford Sterling', 'CDK', 'demo-not-a-real-key', 'tenant_kunes_ford', 'ACTIVE', 1)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "legal_entities"
  ("id", "tenant_id", "entity_code", "legal_name", "display_name", "functional_currency", "country", "fiscal_year_end_month", "status", "effective_date")
VALUES
  ('entity-kunes-delavan', 'tenant-kunes',      'KUNES-IL', 'Kunes Chevrolet of Delavan LLC', 'Kunes Chevy Delavan', 'USD', 'US', 12, 'ACTIVE', '2020-01-01'),
  ('entity-kunes-ford',    'tenant-kunes-ford', 'KUNES-FORD', 'Kunes Ford of Sterling LLC',    'Kunes Ford Sterling', 'USD', 'US', 12, 'ACTIVE', '2020-01-01')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "stores"
  ("id", "tenant_id", "entity_id", "store_code", "store_name", "state_province", "city", "status")
VALUES
  ('store-kunes-delavan', 'tenant-kunes',      'entity-kunes-delavan', 'D01', 'Kunes Chevrolet of Delavan', 'WI', 'Delavan', 'ACTIVE'),
  ('store-kunes-sterling', 'tenant-kunes-ford', 'entity-kunes-ford',   'F01', 'Kunes Ford of Sterling',     'IL', 'Sterling', 'ACTIVE')
ON CONFLICT ("id") DO NOTHING;

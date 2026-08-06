-- S047 — Fleet AR Consolidated Billing. Extends the permission catalog
-- with 3 apar-service permission keys: view, manage parent/unit linkage,
-- and create a consolidated invoice for a fleet parent's units.
--
-- Role design: broad grant (ADMIN/CONTROLLER/ACCOUNTANT) — routine AR
-- clerk/accountant workflow, not a SoD-gated approval path.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant
-- removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.41.0', 'S047: Fleet AR Consolidated Billing — 3 ar.fleet_billing.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ar.fleet_billing.view',                        'View fleet parent/unit linkage, consolidated invoices, and statements', '1.41.0'),
  ('ar.fleet_billing.manage_links',                 'Link or unlink a unit customer to/from a fleet parent',                 '1.41.0'),
  ('ar.fleet_billing.create_consolidated_invoice',  'Create a consolidated invoice across a fleet parent''s linked units',   '1.41.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ar.fleet_billing.view'),
  ('ar.fleet_billing.manage_links'),
  ('ar.fleet_billing.create_consolidated_invoice')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

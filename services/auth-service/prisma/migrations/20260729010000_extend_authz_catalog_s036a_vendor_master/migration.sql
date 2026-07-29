-- AMACC-CH04 S036A: Internal Vendor Master Hardening — permission catalog
-- extension. Per the S220/S003/S009 catalog-extension precedent, a route-level
-- createAuthzGuard() check is worthless against the real HttpAuthzClient
-- unless the permission key actually exists here AND is granted to at least
-- one role — seeded before apar-service's vendor routes are wired to enforce
-- these keys, to avoid repeating that defect class.
--
-- ap.vendor.duplicate_override and ap.vendor.tax_identifier_view are
-- deliberately restricted to ADMIN/CONTROLLER only (sensitive: bypassing a
-- duplicate-vendor warning, and viewing a tax identifier). ap.vendor.delete
-- is likewise ADMIN/CONTROLLER-only even though S036A's guarded delete only
-- ever succeeds for an unreferenced vendor — the permission gate is
-- independent of that runtime guard. ap.vendor.view is granted to
-- ACCOUNTANT as well (matches the read-broad pattern used for je.view /
-- inquiry.account.view), but NOT to a wider role than already holds
-- comparable AP data access — no new role is invented here.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.13.0', 'AMACC-CH04 S036A: ap.vendor.* permission keys for internal vendor-master hardening.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.vendor.view',               'View vendor list and vendor detail', '1.13.0'),
  ('ap.vendor.create',             'Create a new vendor', '1.13.0'),
  ('ap.vendor.edit',               'Edit an existing vendor', '1.13.0'),
  ('ap.vendor.inactivate',         'Inactivate a vendor', '1.13.0'),
  ('ap.vendor.reactivate',         'Reactivate an inactive vendor', '1.13.0'),
  ('ap.vendor.delete',             'Logically delete an unreferenced vendor', '1.13.0'),
  ('ap.vendor.duplicate_override', 'Create a vendor anyway after a duplicate-vendor warning', '1.13.0'),
  ('ap.vendor.audit_view',         'View a vendor''s audit/history timeline', '1.13.0'),
  ('ap.vendor.tax_identifier_view','View a vendor''s full (unmasked) tax identifier', '1.13.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.vendor.view'),
  ('ap.vendor.create'),
  ('ap.vendor.edit')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ap.vendor.inactivate'),
  ('ap.vendor.reactivate'),
  ('ap.vendor.delete'),
  ('ap.vendor.duplicate_override'),
  ('ap.vendor.audit_view'),
  ('ap.vendor.tax_identifier_view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

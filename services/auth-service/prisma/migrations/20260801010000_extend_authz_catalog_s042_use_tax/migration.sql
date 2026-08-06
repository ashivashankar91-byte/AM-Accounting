-- CE-09 S042: Use-Tax Self-Assessment — permission catalog extension.
-- Per the S036A/S038/S039/S041/S043A catalog-extension precedent, a
-- route-level createAuthzGuard() check is worthless against the real
-- HttpAuthzClient unless the permission key actually exists here AND is
-- granted to at least one role.
--
-- ap.use_tax.assess is ADMIN/CONTROLLER/ACCOUNTANT (posts a real GL
-- accrual + register total — same broad grant precedent as
-- ap.manual_payment.create). ap.use_tax.view is granted the same way as
-- other AP view permissions.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.29.0', 'CE-09 S042: ap.use_tax.* permission keys for use-tax self-assessment.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.use_tax.view',   'View use-tax self-assessments and the period register', '1.29.0'),
  ('ap.use_tax.assess', 'Flag a taxable AP invoice for use-tax self-assessment and post the accrual', '1.29.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.use_tax.view'),
  ('ap.use_tax.assess')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

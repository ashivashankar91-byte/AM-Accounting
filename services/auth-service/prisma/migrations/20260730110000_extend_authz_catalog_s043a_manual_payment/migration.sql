-- AMACC-CH04 S043A: Manual Single Payment — permission catalog extension.
-- Per the S036A/S038/S039/S041 catalog-extension precedent, a route-level
-- createAuthzGuard() check is worthless against the real HttpAuthzClient
-- unless the permission key actually exists here AND is granted to at
-- least one role.
--
-- ap.manual_payment.void and ap.manual_payment.retry_schedule_relief are
-- ADMIN/CONTROLLER-only — mirrors the sensitive-action precedent
-- (ap.vendor.delete, ap.invoice.void). ap.manual_payment.view/create are
-- granted to ACCOUNTANT as well (matches the read/write-broad pattern
-- already used for ap.invoice.view/create).
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.26.0', 'AMACC-CH04 S043A: ap.manual_payment.* permission keys for manual single-invoice payment.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.manual_payment.view',                   'View manual AP payments and their GL/schedule posting status', '1.26.0'),
  ('ap.manual_payment.create',                 'Record a manual single payment against an approved vendor invoice', '1.26.0'),
  ('ap.manual_payment.void',                   'Void a manual AP payment', '1.26.0'),
  ('ap.manual_payment.retry_schedule_relief',  'Retry the schedule-service open-item relief for a manual AP payment', '1.26.0'),
  ('ap.bank_account.view',                     'View AP bank accounts available for manual payment', '1.26.0'),
  ('ap.bank_account.manage',                   'Create/configure AP bank accounts', '1.26.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.manual_payment.view'),
  ('ap.manual_payment.create'),
  ('ap.bank_account.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ap.manual_payment.void'),
  ('ap.manual_payment.retry_schedule_relief'),
  ('ap.bank_account.manage')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- S046: Customer AR Master and Credit Profile — permission catalog
-- extension. Same precedent as S036A's vendor-master permission migration
-- (20260729030000_extend_authz_catalog_s036a_vendor_master): a route-level
-- createAuthzGuard() check is worthless against the real HttpAuthzClient
-- unless the permission key actually exists here AND is granted to at least
-- one role — seeded before apar-service's customer routes are wired to
-- enforce these keys.
--
-- ar.customer.duplicate_override, ar.customer.delete, ar.customer.credit_hold
-- and ar.customer.credit_release are restricted to ADMIN/CONTROLLER only
-- (sensitive: bypassing a duplicate-customer warning, logically deleting a
-- customer record, and placing/releasing a credit hold that gates
-- new-charge eligibility platform-wide). ar.customer.view is granted to
-- ACCOUNTANT as well (matches the read-broad pattern used for je.view /
-- inquiry.account.view and ap.vendor.view) — no new role is invented here.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- INTEGRATE BATCH R1-02 renumbering: this migration originally declared
-- catalog_version 1.18.0 and lived under timestamp 20260730000000 on the
-- S046 branch. Renumbered to 1.23.0 — the next free slot after this batch's
-- S038 vendor-insurance migration (1.22.0) — and moved to timestamp
-- 20260730080000 so no two auth-service migrations share a timestamp
-- prefix within this batch.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.23.0', 'S046: ar.customer.* permission keys for customer AR master and credit profile.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ar.customer.view',               'View customer list and customer detail', '1.23.0'),
  ('ar.customer.create',             'Create a new customer', '1.23.0'),
  ('ar.customer.edit',               'Edit an existing customer', '1.23.0'),
  ('ar.customer.inactivate',         'Inactivate a customer', '1.23.0'),
  ('ar.customer.reactivate',         'Reactivate an inactive customer', '1.23.0'),
  ('ar.customer.delete',             'Logically delete a customer', '1.23.0'),
  ('ar.customer.duplicate_override', 'Create a customer anyway after a duplicate-customer warning', '1.23.0'),
  ('ar.customer.audit_view',         'View a customer''s audit/history timeline', '1.23.0'),
  ('ar.customer.credit_hold',        'Place a credit hold on a customer', '1.23.0'),
  ('ar.customer.credit_release',     'Release a customer''s credit hold', '1.23.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ar.customer.view'),
  ('ar.customer.create'),
  ('ar.customer.edit')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ar.customer.inactivate'),
  ('ar.customer.reactivate'),
  ('ar.customer.delete'),
  ('ar.customer.duplicate_override'),
  ('ar.customer.audit_view'),
  ('ar.customer.credit_hold'),
  ('ar.customer.credit_release')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

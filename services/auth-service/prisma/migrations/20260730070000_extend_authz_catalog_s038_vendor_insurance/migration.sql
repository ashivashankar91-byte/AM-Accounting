-- AMACC-CH04 S038: Vendor Insurance Certificate Management — permission
-- catalog extension. Per the S036A/S011/S003/S009 catalog-extension
-- precedent, a route-level createAuthzGuard() check is worthless against the
-- real HttpAuthzClient unless the permission key actually exists here AND is
-- granted to at least one role — seeded before apar-service's insurance-
-- certificate routes are wired to enforce these keys.
--
-- ap.vendor_insurance.revoke and ap.vendor_insurance.audit_view are
-- restricted to ADMIN/CONTROLLER only (sensitive: revoking a compliance
-- record and viewing its full audit history) — mirrors the S036A precedent
-- for ap.vendor.delete/audit_view. ap.vendor_insurance.view/create/edit/
-- renew are granted to ACCOUNTANT as well (matches the read/write-broad
-- pattern already used for ap.vendor.view/create/edit) — no new role is
-- invented here.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- INTEGRATE BATCH R1-02 renumbering: this migration originally declared
-- catalog_version 1.18.0 and lived under timestamp 20260730000000 on the
-- S038 branch. Renumbered to 1.22.0 — the next free slot after this batch's
-- S036B vendor-compliance migration (1.21.0) — and moved to timestamp
-- 20260730070000 so no two auth-service migrations share a timestamp
-- prefix within this batch (20260730040000/050000/060000 already claimed
-- by this same batch's S026/S027/S036B migrations).

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.22.0', 'AMACC-CH04 S038: ap.vendor_insurance.* permission keys for vendor insurance certificate management.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.vendor_insurance.view',       'View vendor insurance certificates and expiration status', '1.22.0'),
  ('ap.vendor_insurance.create',     'Create a new vendor insurance certificate', '1.22.0'),
  ('ap.vendor_insurance.edit',       'Edit non-defining fields of the current vendor insurance certificate', '1.22.0'),
  ('ap.vendor_insurance.renew',      'Renew/replace a vendor insurance certificate with a new coverage period', '1.22.0'),
  ('ap.vendor_insurance.revoke',     'Revoke the current vendor insurance certificate', '1.22.0'),
  ('ap.vendor_insurance.audit_view', 'View a vendor insurance certificate''s audit/history timeline', '1.22.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.vendor_insurance.view'),
  ('ap.vendor_insurance.create'),
  ('ap.vendor_insurance.edit'),
  ('ap.vendor_insurance.renew')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ap.vendor_insurance.revoke'),
  ('ap.vendor_insurance.audit_view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

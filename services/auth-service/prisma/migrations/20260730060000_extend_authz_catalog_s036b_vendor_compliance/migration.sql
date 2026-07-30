-- AMACC-CH04 S036B: Vendor Compliance Adapters — permission catalog
-- extension. Same precedent as S036A's own catalog extension
-- (20260729030000_extend_authz_catalog_s036a_vendor_master): a route-level
-- createAuthzGuard() check is worthless unless the permission key actually
-- exists here AND is granted to at least one role.
--
-- ap.vendor_compliance.review is restricted to ADMIN/CONTROLLER only —
-- mirrors ap.vendor.inactivate/reactivate (a sensitive lifecycle action, not
-- a routine data-entry one). ACCOUNTANT gets view/create/edit/run_verification
-- (creating a check and running the — currently manual/no-op — adapter
-- against it is non-destructive and produces no automatic pass/fail
-- attestation), matching the read/write-broad but review-narrow pattern
-- already used for ap.vendor.*.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- INTEGRATE BATCH R1-02 renumbering: this migration originally declared
-- catalog_version 1.18.0 and lived under timestamp 20260730040000 on the
-- S036B branch. Renumbered to 1.21.0 — the next free slot after this
-- batch's S027 aging migration (1.20.0) — and moved to timestamp
-- 20260730060000 so no two auth-service migrations share a timestamp
-- prefix (20260730040000/050000 are already claimed by this same batch's
-- S026/S027 migrations). Same precedent as prior R1 renumbering passes
-- (S009/S036A/posting-engine).

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.21.0', 'AMACC-CH04 S036B: ap.vendor_compliance.* permission keys for vendor compliance adapters.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.vendor_compliance.view',             'View a vendor''s compliance checks', '1.21.0'),
  ('ap.vendor_compliance.create',           'Create a new vendor compliance check', '1.21.0'),
  ('ap.vendor_compliance.edit',             'Edit an unreviewed vendor compliance check', '1.21.0'),
  ('ap.vendor_compliance.run_verification', 'Run the configured compliance verification adapter against a check', '1.21.0'),
  ('ap.vendor_compliance.review',           'Manually review a compliance check (verify, reject, or mark expired)', '1.21.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.vendor_compliance.view'),
  ('ap.vendor_compliance.create'),
  ('ap.vendor_compliance.edit'),
  ('ap.vendor_compliance.run_verification')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ap.vendor_compliance.review')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

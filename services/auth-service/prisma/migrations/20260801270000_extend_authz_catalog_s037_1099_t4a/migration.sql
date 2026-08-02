-- S037 — 1099/T4A Flag Rules & Preview. Extends the permission catalog
-- with 4 apar-service permission keys: view (box rules, thresholds,
-- corrections, year-preview), manage per-vendor box rules, manage
-- statutory threshold config, and post an audited correction.
--
-- Role design: broad grant (ADMIN/CONTROLLER/ACCOUNTANT) — routine
-- year-end AP/tax-prep workflow, not a SoD-gated approval path. Actual
-- e-filing transmission is explicitly out of scope for this story
-- (compliance-vendor scope) and is not represented by any permission key
-- here.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant
-- removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.43.0', 'S037: 1099/T4A Flag Rules & Preview — 4 ap.vendor_1099.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.vendor_1099.view',              'View 1099/T4A vendor box rules, threshold configs, corrections, and the year-preview report', '1.43.0'),
  ('ap.vendor_1099.manage_box_rules',  'Set a per-vendor 1099/T4A box/class flag rule for a tax year',                                '1.43.0'),
  ('ap.vendor_1099.manage_thresholds', 'Set the tenant jurisdiction statutory reporting threshold for a form type/tax year',           '1.43.0'),
  ('ap.vendor_1099.post_correction',   'Post an audited correction to a vendor''s computed 1099/T4A accumulation (never a silent edit)', '1.43.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.vendor_1099.view'),
  ('ap.vendor_1099.manage_box_rules'),
  ('ap.vendor_1099.manage_thresholds'),
  ('ap.vendor_1099.post_correction')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

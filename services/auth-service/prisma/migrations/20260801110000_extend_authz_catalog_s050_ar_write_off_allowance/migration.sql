-- S050 — AR Write-offs & Allowance Model. Extends the permission catalog
-- with 8 apar-service permission keys: direct write-off view/create/
-- override/reverse, and allowance preview view/compute/approve/post.
--
-- Role design: write-off view/create/reverse and allowance view/compute/
-- approve/post are broad (ADMIN/CONTROLLER/ACCOUNTANT — everyday AR
-- operations, including the accountant-approval step the AC requires for
-- the allowance preview). The write-off THRESHOLD OVERRIDE is the
-- "higher-authority" permission (D-CE09 AC: "unless a higher-authority
-- override permission is used, also audited") and is restricted to
-- ADMIN/CONTROLLER only, mirroring the S048 title-release-exception
-- precedent.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.37.0', 'S050: AR write-offs & allowance model — 8 ar.write_off.*/ar.allowance.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ar.write_off.view',       'View direct AR write-offs and the write-off register',                          '1.37.0'),
  ('ar.write_off.create',     'Create a direct AR write-off (reason required)',                                '1.37.0'),
  ('ar.write_off.override',   'Higher-authority override to post a write-off above the configured threshold',  '1.37.0'),
  ('ar.write_off.reverse',    'Reverse a posted direct AR write-off (restores the AR item)',                   '1.37.0'),
  ('ar.allowance.view',       'View AR allowance previews',                                                    '1.37.0'),
  ('ar.allowance.compute_preview', 'Compute an aging-based allowance preview (never posts)',                   '1.37.0'),
  ('ar.allowance.approve_preview', 'Approve an allowance preview prior to posting',                            '1.37.0'),
  ('ar.allowance.post',       'Post an approved allowance adjustment (amount must match the approved preview)', '1.37.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant including the threshold override.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('ar.write_off.view'),
  ('ar.write_off.create'),
  ('ar.write_off.override'),
  ('ar.write_off.reverse'),
  ('ar.allowance.view'),
  ('ar.allowance.compute_preview'),
  ('ar.allowance.approve_preview'),
  ('ar.allowance.post')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: everyday AR write-off/allowance operations, but NOT the
-- threshold override.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ACCOUNTANT', k
FROM (VALUES
  ('ar.write_off.view'),
  ('ar.write_off.create'),
  ('ar.write_off.reverse'),
  ('ar.allowance.view'),
  ('ar.allowance.compute_preview'),
  ('ar.allowance.approve_preview'),
  ('ar.allowance.post')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

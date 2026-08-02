-- CE-15 Close & Statutory epic — authz permission catalog extension.
--
-- Six distinct close authorities enforced server-side (D-S023-28 pattern):
--   close.initiate | close.override_exception | close.preliminary_close |
--   close.final_close | close.reopen | close.post_close_adjustment
-- Additional: close.view_readiness | close.sign_snapshot | close.manage_archive |
--   close.manage_currency | close.statutory_evidence_approve
-- Plus operational surfaces: close.year_end_run | close.kpi_manage | close.compliance_generate
--
-- Additive only. No existing keys removed. No existing grants removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.30.0', 'CE-15 Close & Statutory epic: close.* permission tier (13 keys) — six SoD close authorities + operational surfaces.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('close.view_readiness',          'View close period state, readiness signals and audit history',                '1.30.0'),
  ('close.initiate',                'Initiate close workflow, create and manage close tasks',                     '1.30.0'),
  ('close.override_exception',      'Override a scrub exception with documented reason (SoD: cannot grant final close)', '1.30.0'),
  ('close.preliminary_close',       'Execute preliminary close (soft lock) for a period',                        '1.30.0'),
  ('close.final_close',             'Grant final close (hard lock) for a period (SoD: cannot have overridden exceptions)', '1.30.0'),
  ('close.reopen',                  'Request reopen of a closed period (requires dual approval)',                 '1.30.0'),
  ('close.post_close_adjustment',   'Post adjusting entries into the open period with closed-period linkage',    '1.30.0'),
  ('close.statutory_evidence_approve', 'Approve statutory evidence packages for a period',                      '1.30.0'),
  ('close.sign_snapshot',           'Sign a financial-statement snapshot (primary or secondary, dual-sign SoD)', '1.30.0'),
  ('close.manage_archive',          'Manage WORM archive objects, retention schedules and PII shred ceremonies', '1.30.0'),
  ('close.manage_currency',         'Configure entity functional currency, rate sources and translation runs',   '1.30.0'),
  ('close.year_end_run',            'Preview, approve and post the year-end retained-earnings roll',             '1.30.0'),
  ('close.kpi_manage',              'Manage KPI formula registry and compute period KPI results',                '1.30.0'),
  ('close.compliance_generate',     'Generate compliance reporting packs, tax packs and PBC exports',            '1.30.0')
ON CONFLICT ("key") DO NOTHING;

-- ── Role grants ───────────────────────────────────────────────────────────────
-- READ-BROAD: ADMIN, CONTROLLER, ACCOUNTANT
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('close.view_readiness')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN + CONTROLLER only — close workflow authorities
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('close.initiate'),
  ('close.preliminary_close'),
  ('close.final_close'),
  ('close.reopen'),
  ('close.year_end_run'),
  ('close.sign_snapshot'),
  ('close.compliance_generate'),
  ('close.kpi_manage'),
  ('close.manage_currency')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Exception override: CONTROLLER only (SoD boundary vs final-close)
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('CONTROLLER', 'close.override_exception')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Post-close adjustment: ADMIN only
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('ADMIN', 'close.post_close_adjustment')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Statutory evidence approve: ADMIN only
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('ADMIN', 'close.statutory_evidence_approve')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Archive manage: ADMIN only
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('ADMIN', 'close.manage_archive')
ON CONFLICT ("role", "permission_key") DO NOTHING;

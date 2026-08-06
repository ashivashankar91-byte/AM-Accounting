-- S052 — POS Cash Receipts, Cashier Drawers, Blind Close and Over/Short.
-- Extends the S207 permission catalog with the 10 cash-service permission
-- keys named in the approved S052 scope. Per the S220/S004A catalog-
-- extension precedent (see 20260728000001_extend_authz_catalog_gl_inquiry),
-- a route-level createAuthzGuard() check is worthless against the real
-- HttpAuthzClient unless the key actually exists in this catalog and is
-- granted to at least one role — seeded here BEFORE cash-service's routes
-- are wired, to avoid repeating that defect class.
--
-- Role design (segregation of duties — a cash-handling control, not just a
-- convenience split): CASHIER gets the day-to-day POS actions; SUPERVISOR
-- (new role) gets oversight-only (view/reprint/reconcile/approve) and
-- deliberately NOT open/create/void, so a supervisor cannot both create and
-- approve their own drawer activity. ADMIN/CONTROLLER get every key, for
-- full oversight and emergency capability, matching the existing precedent
-- of ADMIN/CONTROLLER holding the broadest grants elsewhere in this catalog
-- (e.g. je.post).
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- R1 Controlled Integration renumbering: this migration originally declared
-- catalog_version 1.13.0. S011's auth migration
-- (20260728070000_extend_authz_catalog_analysis_codes) already claims
-- 1.13.0. Renumbered to 1.18.0 — the next free slot after this branch's
-- highest integrated version (1.17.0, S036A internal vendor master).
-- Folder timestamp 20260729050000 has no collision (target's latest
-- auth-service migration is 20260729030000) and is retained as-is, so
-- ordering after S036A is preserved. Same precedent as S009's renumbering
-- around S003 and S036A's renumbering around S011/S032.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.18.0', 'S052: POS cash receipts, cashier drawers, blind close and over/short — 10 cash.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('cash.drawer.open',      'Open a cashier drawer session',                                    '1.18.0'),
  ('cash.drawer.view_own',  'View the cashier''s own active/past drawer sessions',               '1.18.0'),
  ('cash.drawer.view_all',  'View any cashier''s drawer sessions at the tenant',                 '1.18.0'),
  ('cash.receipt.create',   'Issue a cash/check POS receipt against an open drawer',             '1.18.0'),
  ('cash.receipt.view',     'View/search cash receipts',                                        '1.18.0'),
  ('cash.receipt.reprint',  'Reprint an issued receipt',                                         '1.18.0'),
  ('cash.receipt.void',     'Void an eligible (still-OPEN-drawer) cash receipt',                 '1.18.0'),
  ('cash.drawer.blind_close', 'Submit a cashier''s blind drawer count',                          '1.18.0'),
  ('cash.drawer.reconcile',  'View supervisor drawer reconciliation and reconcile a drawer',     '1.18.0'),
  ('cash.variance.approve',  'Approve an out-of-tolerance or non-cash-exception drawer variance', '1.18.0')
ON CONFLICT ("key") DO NOTHING;

-- CASHIER: the day-to-day POS workflow. No reconcile/approve — a cashier
-- never approves their own drawer's variance.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'CASHIER', k FROM (VALUES
  ('cash.drawer.open'), ('cash.drawer.view_own'), ('cash.receipt.create'),
  ('cash.receipt.view'), ('cash.receipt.reprint'), ('cash.receipt.void'),
  ('cash.drawer.blind_close')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- SUPERVISOR (new role): oversight-only — deliberately excludes open/create/void.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'SUPERVISOR', k FROM (VALUES
  ('cash.drawer.view_all'), ('cash.receipt.view'), ('cash.receipt.reprint'),
  ('cash.drawer.reconcile'), ('cash.variance.approve')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant, matching the existing je.post precedent.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('cash.drawer.open'), ('cash.drawer.view_own'), ('cash.drawer.view_all'),
  ('cash.receipt.create'), ('cash.receipt.view'), ('cash.receipt.reprint'), ('cash.receipt.void'),
  ('cash.drawer.blind_close'), ('cash.drawer.reconcile'), ('cash.variance.approve')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

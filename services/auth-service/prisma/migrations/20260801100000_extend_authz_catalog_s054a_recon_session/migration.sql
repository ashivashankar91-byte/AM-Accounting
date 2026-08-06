-- S054A — Manual Bank Reconciliation Workbench. Extends the permission
-- catalog with 6 recon-service permission keys covering the session
-- lifecycle: create, view, manage statement lines, manage book items
-- (manual entry + sync from cash-service/apar-service), match/unmatch, and
-- complete (the conservation-gated one-way lock). Follows the
-- S052/S053/S055/S056/S057 precedent exactly.
--
-- Role design: CREATE/LINE_MANAGE/BOOKITEM_MANAGE/MATCH/COMPLETE are
-- money-adjacent reconciliation actions restricted to ADMIN/CONTROLLER;
-- VIEW is broad (ADMIN/CONTROLLER/SUPERVISOR — read-only oversight).
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.36.0', 'S054A: manual bank reconciliation workbench — 6 recon.session.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('recon.session.create',           'Create a reconciliation session for a bank account + statement period', '1.36.0'),
  ('recon.session.view',             'View reconciliation sessions, statement lines, and book items',         '1.36.0'),
  ('recon.session.line.manage',      'Add manual or imported statement lines to a reconciliation session',    '1.36.0'),
  ('recon.session.bookitem.manage',  'Add manual book items or sync book items from cash-service/apar-service', '1.36.0'),
  ('recon.session.match',            'Match/clear or unmatch a statement line against a book item',           '1.36.0'),
  ('recon.session.complete',         'Complete a reconciliation session (conservation-check gated)',          '1.36.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full grant.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('recon.session.create'), ('recon.session.view'), ('recon.session.line.manage'),
  ('recon.session.bookitem.manage'), ('recon.session.match'), ('recon.session.complete')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- SUPERVISOR: view-only oversight.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'SUPERVISOR', k FROM (VALUES ('recon.session.view')) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

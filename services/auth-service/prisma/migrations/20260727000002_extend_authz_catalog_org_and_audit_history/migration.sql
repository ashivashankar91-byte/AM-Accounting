-- R0 Golden Fleet: extend the S207 permission catalog with the S202 (org
-- tree) and S224 (document audit history) permission keys.
--
-- S224 defect closure: audit.view/audit.export were implemented at the
-- route level (services/audit-service/src/http/routes.ts, S224 commit
-- 9f5a4cf) gated by createAuthzGuard, but were never actually registered in
-- this real catalog — so, against the live gateway, HttpAuthzClient would
-- have found zero matching role_permission rows and denied every caller,
-- including ADMIN. Found while implementing S202 (checking whether org.tree.*
-- needed the same catalog seeding step) and fixed here rather than silently
-- left in place. No AUDITOR role exists anywhere in the repository yet (grep
-- confirms zero hits) despite S224's "Auditor" persona — granted to
-- ADMIN/CONTROLLER (full) and ACCOUNTANT (view-only) to match this catalog's
-- existing role model instead of inventing an unreviewed new role; a
-- dedicated AUDITOR role is an explicit, documented known gap, not silently
-- worked around.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.4.0', 'Golden-R0 Fleet: org.tree.* (S202) and audit.view/audit.export (S224 defect closure) permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('org.tree.view',   'View the dealer group organization hierarchy tree',       '1.4.0'),
  ('org.tree.manage', 'Re-parent a node in the organization hierarchy tree',     '1.4.0'),
  ('audit.view',      'View a document''s audit history',                       '1.4.0'),
  ('audit.export',    'Export a document''s audit history as CSV',              '1.4.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN / CONTROLLER: full manage + view for org tree; full view + export for audit history.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('org.tree.view'), ('org.tree.manage'),
  ('audit.view'), ('audit.export')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: view-only for both (matches this catalog's existing
-- view-only-role convention for ACCOUNTANT elsewhere).
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ACCOUNTANT', 'org.tree.view'),
  ('ACCOUNTANT', 'audit.view')
ON CONFLICT ("role", "permission_key") DO NOTHING;

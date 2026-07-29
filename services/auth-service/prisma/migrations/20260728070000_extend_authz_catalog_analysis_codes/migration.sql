-- S011 Analysis Codes / Dimensions — permission catalog extension.
--
-- The approved Story Contract text names a single permission,
-- `analysis.code.manage` (registry CRUD: create/edit/deactivate analysis
-- code types and values). A second permission, `analysis.code.view`, is
-- added here as a documented ENGINEERING-CONVENTION addition (not an
-- invented business rule): it mirrors the existing acct.dept.view /
-- acct.dept.manage split (tenant-service department-routes.ts) so an
-- Accountant can list active analysis code types/values to tag a JE line
-- (existing je.draft.create/je.draft.edit already gates the tagging act
-- itself) without also holding registry-management rights. Line tagging and
-- inquiry/search filtering ride the EXISTING je.draft.*, inquiry.account.view
-- and inquiry.search permission keys — no new key is needed for those.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- Integration note (r1-integration): folder timestamp renamed from the
-- source branch's native 20260728050000 (which collided with the already-
-- integrated S008 migration of the identical timestamp) to 20260728070000,
-- and catalog_version bumped from the source branch's standalone 1.10.0 to
-- 1.13.0 to continue the monotonic sequence already established by the
-- integrated S008 (1.10.0) / S003 (1.11.0) / S009 (1.12.0) migrations. No
-- functional SQL below was altered.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.13.0', 'Golden-R0 Fleet: analysis.code.view / analysis.code.manage (S011 Analysis Codes / Dimensions) permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('analysis.code.view', 'View the tenant analysis-code/dimension registry (types and values) — read-only, distinct from manage so tagging a JE line does not require registry-management rights', '1.13.0'),
  ('analysis.code.manage', 'Create, edit and deactivate analysis-code types and values in the tenant registry', '1.13.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'analysis.code.view'
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'analysis.code.manage'
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;

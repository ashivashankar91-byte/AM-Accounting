-- S032 — authorization-only corrective pass. Independent acceptance review
-- approved Permission Option A (S032-COMPLETION.md §4/§Permission review):
-- ACCOUNTANT keeps je.template.view/generate but loses je.template.manage —
-- template definition (create/edit/activate/deactivate) becomes a
-- Controller/Admin-only action, matching this catalog's existing precedent
-- for every other reusable/structural master-data object (coa.account,
-- coa.source, fiscal.calendar all restrict *.manage to ADMIN/CONTROLLER and
-- give ACCOUNTANT view-only). ACCOUNTANT's je.template.generate and
-- je.template.view grants (added in v1.14.0 on this branch) are untouched,
-- and ADMIN's / CONTROLLER's je.template.manage grants are untouched.
--
-- Additive-only in spirit (no destructive DDL): this migration deletes
-- exactly one role_permission row and adds a new catalog_version marker; it
-- removes no permission key, no table, no other role's grant.
--
-- Integration note (r1-integration): catalog_version bumped from the source
-- branch's standalone 1.11.0 to 1.15.0 to continue the monotonic sequence
-- (this branch's own preceding S032 migration already claims 1.14.0, not
-- 1.10.0). No functional SQL below was altered.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.15.0', 'S032 authorization-only corrective pass: revoke je.template.manage from ACCOUNTANT (approved Permission Option A).')
ON CONFLICT ("version") DO NOTHING;

DELETE FROM "role_permission"
WHERE "role" = 'ACCOUNTANT' AND "permission_key" = 'je.template.manage';

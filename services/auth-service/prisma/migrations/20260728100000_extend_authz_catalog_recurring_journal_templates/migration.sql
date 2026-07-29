-- S032 — extend the S207 permission catalog with the Recurring Journal
-- Templates permission keys (P01_STORY_CONTRACTS.md S032: "Authorization.
-- je.template.manage, je.template.generate; posting = existing je.post").
--
-- je.template.view is added alongside them (not named in the prose contract)
-- so GET reads have their own least-privilege key instead of silently
-- riding on .manage/.generate — the same pattern S212 already established
-- for coa.source.view vs coa.source.manage.
--
-- Granted to ADMIN/CONTROLLER/ACCOUNTANT only, matching the story's named
-- persona ("Accountant / Controller") — CLERK is deliberately excluded, the
-- same restriction already applied to S221 GL Search (a comparable
-- cross-account authoring/read surface, not a single-draft action).
--
-- Additive-only. No destructive DDL, no key removed, no existing grant removed.
--
-- Integration note (r1-integration): catalog_version bumped from the source
-- branch's standalone 1.10.0 to 1.14.0 to continue the monotonic sequence
-- already established by the integrated S008 (1.10.0) / S003 (1.11.0) /
-- S009 (1.12.0) / S011 (1.13.0) migrations. Folder timestamp unchanged
-- (20260728100000) — no collision against any migration already on this
-- branch. No functional SQL below was altered.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.14.0', 'S032 Recurring Journal Templates: je.template.manage / je.template.generate / je.template.view permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('je.template.manage',   'Create / edit / activate / deactivate recurring journal templates', '1.14.0'),
  ('je.template.generate', 'Generate draft journals from recurring journal templates for a period', '1.14.0'),
  ('je.template.view',     'View recurring journal templates and their generation history', '1.14.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('je.template.manage'), ('je.template.generate'), ('je.template.view')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

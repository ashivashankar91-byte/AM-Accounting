-- S014 Trial Balance API permission catalog extension.
-- Follows the same additive pattern as the recent S220/S221/gl-service
-- onboarding migrations: one new permission key, deny-by-default unless
-- explicitly granted, and grants only to the approved accounting roles with
-- existing read-only/reporting precedent.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.8.0', 'Golden-R0 Fleet: report.tb.view (S014 Trial Balance API) permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('report.tb.view', 'View the GL trial balance report for an entity/store/department slice as of a fiscal period', '1.8.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'report.tb.view'
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;


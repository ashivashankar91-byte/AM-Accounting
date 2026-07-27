-- S227 Balance Sheet & Income Statement permission catalog extension.
-- Follows the same additive pattern as the S014 report.tb.view migration:
-- one new permission key, deny-by-default unless explicitly granted, and
-- grants only to the approved accounting roles with existing read-only/
-- reporting precedent (matches the approved Story Contract's
-- `report.fs.view` permission for S227).

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.9.0', 'Golden-R0 Fleet: report.fs.view (S227 Balance Sheet & Income Statement) permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('report.fs.view', 'View the Balance Sheet and Income Statement for an entity/store/department slice as of a fiscal period', '1.9.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'report.fs.view'
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;

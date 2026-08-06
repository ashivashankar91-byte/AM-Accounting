-- S003 Elimination Entity Configuration permission catalog extension.
--
-- Adds a distinct, elevated permission for the elimination-flag ceremony
-- rather than riding the existing acct.entity.manage grant (BLK-17): flagging
-- an entity as an elimination entity is a group-Controller governance
-- decision, not routine entity CRUD, so it gets its own key with a narrower
-- role grant (ADMIN + CONTROLLER only — no SERVICE, unlike acct.entity.manage).
-- Additive-only. No existing key or grant is modified or removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.11.0', 'S003 Elimination Entity Configuration: acct.entity.elimination_configure permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('acct.entity.elimination_configure', 'Designate or unset a legal entity as an elimination entity', '1.11.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN + CONTROLLER only: group-level governance decision, distinct
-- (narrower) authority from routine acct.entity.manage.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN',      'acct.entity.elimination_configure'),
  ('CONTROLLER', 'acct.entity.elimination_configure')
ON CONFLICT ("role", "permission_key") DO NOTHING;

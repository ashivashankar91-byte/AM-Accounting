-- S021 Posting Recovery — R1 completion slice: real replay execution.
--
-- posting-recovery.replay.execute is a distinct, narrower permission from
-- the five read permissions granted in
-- 20260731010000_extend_authz_catalog_s021_posting_recovery — executing a
-- replay calls the real S019/S020 posting engine and can create a real
-- journal entry, so it is granted only to ADMIN and CONTROLLER (matches the
-- narrower-authority precedent already set by
-- posting-recovery.payload.read-sensitive in that same migration), NOT to
-- ACCOUNTANT even though ACCOUNTANT holds queue/case/payload/audit read.
-- Additive-only. No existing key or grant is modified or removed.
--
-- CE-07 integration renumbering: originally catalog_version 1.19.0 on the
-- unmerged branch; renumbered to 1.28.0, the next free slot after this
-- migration's own sibling above (1.27.0).

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.28.0', 'S021 Posting Recovery: posting-recovery.replay.execute permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('posting-recovery.replay.execute', 'Execute a real replay of a posting dead-letter case against the posting engine', '1.28.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'posting-recovery.replay.execute'
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;

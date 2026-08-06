-- CE-12 (S024) — adds posting_engine.rule_pack.simulate, the dry-run
-- blueprint-preview permission the S085 biller workbench requires
-- ("recap-vs-journal preview" before release/post). Additive-only.
--
-- catalog_version: both 20260801010000 (CE-08) and 20260801020000 (CE-10)
-- declared 1.29.0 (each independently the "next free slot" at authoring
-- time; the ON CONFLICT DO NOTHING on the version row means only the first
-- to apply wins, which is harmless — the row is an informational marker,
-- not a uniqueness gate on the permission keys themselves). This migration
-- uses 1.30.0, the next free slot after both.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.30.0', 'CE-12 S024: posting_engine.rule_pack.simulate permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('posting_engine.rule_pack.simulate', 'Dry-run rule-pack blueprint preview (no persistence/posting)', '1.30.0')
ON CONFLICT ("key") DO NOTHING;

-- Same read-only/non-destructive grant set as rule_pack.view/validate.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'posting_engine.rule_pack.simulate'
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;

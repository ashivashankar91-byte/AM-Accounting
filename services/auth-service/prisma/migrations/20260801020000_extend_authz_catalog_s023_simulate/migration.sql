-- CE-07 / S023 — new capability, added under the existing
-- posting_engine.<noun>.<verb> namespace (S023_PERMISSION_MATRIX.md,
-- D-S023-29/33). Simulate is read-adjacent (validation + rule evaluation
-- only, never posts a journal — see PostingEngineService.simulateEvent),
-- so it is granted the same ADMIN/CONTROLLER/ACCOUNTANT set as the other
-- non-destructive posting_engine.* permissions. Replay does NOT get a new
-- permission here — it reuses the already-existing
-- posting-recovery.replay.execute (1.28.0), per the approved Permission
-- Matrix. Additive-only.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.29.0', 'CE-07/S023: posting_engine.rule_pack.simulate permission key.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('posting_engine.rule_pack.simulate', 'Run a dry-run evaluation of a posting-engine event against the active rule pack — no journal posted, no schedule effect', '1.29.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'posting_engine.rule_pack.simulate'
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- S021 Posting Recovery (DLQ inspection workbench) permission catalog extension.
--
-- Five distinct read permissions, matching the S021 story's explicit
-- authorized/unauthorized/masked/sensitive distinction requirement:
--   - posting-recovery.queue.read:            list/search/filter the DLQ.
--   - posting-recovery.case.read:              open one case's detail.
--   - posting-recovery.payload.read:            view the masked original payload.
--   - posting-recovery.payload.read-sensitive:  view unmasked sensitive payload fields.
--   - posting-recovery.audit.read:              view the recovery audit timeline.
-- Additive-only. No existing key or grant is modified or removed. This
-- slice grants queue/case/payload/audit read to ADMIN, CONTROLLER and
-- ACCOUNTANT (day-to-day recovery review), and read-sensitive only to
-- ADMIN + CONTROLLER (matches the narrower-authority precedent set by
-- acct.entity.elimination_configure in the S003 migration).
--
-- CE-07 integration renumbering: this migration originally declared
-- catalog_version 1.18.0 on the unmerged r1-s021-posting-recovery-completion
-- branch (itself already once renumbered from 1.13.0). r1-integration's
-- catalog sequence has since advanced past that (S036B/S038/S046/S039/S041/
-- S043A all landed at 1.18.0-1.26.0 while S021 stayed on an unmerged
-- branch). Renumbered to 1.27.0 — the next free slot after this worktree's
-- highest integrated version (1.26.0, S043A manual payment) — and moved to
-- timestamp 20260731010000 so no two auth-service migrations share a
-- timestamp prefix. Same precedent as S009/S036A/posting-engine's own
-- renumbering around S003/S011/S032.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.27.0', 'S021 Posting Recovery: posting-recovery.queue.read, case.read, payload.read, payload.read-sensitive, audit.read permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('posting-recovery.queue.read',            'List/search/filter the tenant-scoped posting dead-letter queue', '1.27.0'),
  ('posting-recovery.case.read',              'View one posting dead-letter case''s detail, failure history, attempts, corrections and lineage', '1.27.0'),
  ('posting-recovery.payload.read',            'View the masked original event payload for a posting dead-letter case', '1.27.0'),
  ('posting-recovery.payload.read-sensitive',  'View unmasked sensitive fields of the original event payload', '1.27.0'),
  ('posting-recovery.audit.read',              'View the recovery audit timeline for a posting dead-letter case', '1.27.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('posting-recovery.queue.read'),
  ('posting-recovery.case.read'),
  ('posting-recovery.payload.read'),
  ('posting-recovery.audit.read')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Narrower authority: unmasked sensitive payload values are ADMIN + CONTROLLER only.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, 'posting-recovery.payload.read-sensitive'
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
ON CONFLICT ("role", "permission_key") DO NOTHING;

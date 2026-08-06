-- S008 Period Close Control permission catalog extension.
--
-- Adds the transition-specific permission keys required by the approved
-- S008 v1 policy decisions:
--   - fiscal.period.soft_close / fiscal.period.hard_close: CONTROLLER+ADMIN,
--     matching the existing fiscal.period.open precedent (fiscal-close
--     authority sits with Controller/Admin roles, not Accountant/Clerk).
--   - fiscal.period.reopen (SOFT_CLOSED->OPEN): CONTROLLER+ADMIN.
--   - fiscal.period.reopen_hard_closed (HARD_CLOSED->OPEN): ADMIN only,
--     per PO decision ("separate permission" for the higher-risk
--     hard-close reopen transition).
--   - fiscal.period.lock (terminal, irreversible in v1): ADMIN only.
--   - fiscal.je.mark_adjusting: ADMIN+CONTROLLER+ACCOUNTANT, matching the
--     existing je.reverse / je.draft.edit precedent for accounting-staff
--     authority over journal attributes.
-- Additive-only. No existing key or grant is modified or removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.10.0', 'S008 Period Close Control: soft/hard close, reopen, reopen_hard_closed, lock, and mark_adjusting permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('fiscal.period.soft_close',        'Transition a fiscal period OPEN -> SOFT_CLOSED',                         '1.10.0'),
  ('fiscal.period.hard_close',        'Transition a fiscal period SOFT_CLOSED -> HARD_CLOSED',                  '1.10.0'),
  ('fiscal.period.reopen',            'Reopen a fiscal period SOFT_CLOSED -> OPEN',                              '1.10.0'),
  ('fiscal.period.reopen_hard_closed','Reopen a fiscal period HARD_CLOSED -> OPEN (elevated, distinct authority)', '1.10.0'),
  ('fiscal.period.lock',              'Lock a fiscal period HARD_CLOSED -> LOCKED (terminal, irreversible in v1)', '1.10.0'),
  ('fiscal.je.mark_adjusting',        'Mark a manual journal draft as an adjusting entry, with mandatory reason/correction reference', '1.10.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN + CONTROLLER: soft-close, hard-close, reopen (SOFT_CLOSED->OPEN),
-- and mark_adjusting all follow the existing fiscal.period.open precedent.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('fiscal.period.soft_close'),
  ('fiscal.period.hard_close'),
  ('fiscal.period.reopen')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN only: the two highest-risk transitions (hard-close reopen, lock).
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN', 'fiscal.period.reopen_hard_closed'),
  ('ADMIN', 'fiscal.period.lock')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ADMIN + CONTROLLER + ACCOUNTANT: mark_adjusting, matching the
-- je.reverse / je.draft.edit accounting-staff-authority precedent.
INSERT INTO "role_permission" ("role", "permission_key") VALUES
  ('ADMIN', 'fiscal.je.mark_adjusting'),
  ('CONTROLLER', 'fiscal.je.mark_adjusting'),
  ('ACCOUNTANT', 'fiscal.je.mark_adjusting')
ON CONFLICT ("role", "permission_key") DO NOTHING;

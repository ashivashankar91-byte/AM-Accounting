-- CE-17 Accounting Automation epic — authz permission catalog extension.
--
-- Stories: S022 (rule simulation sandbox), S040 (OCR/EDI invoice ingestion),
-- S058 (lockbox AI remittance matching), S073 (LIFO overlay), S091B
-- (experience-rated chargeback model), S095 (retro/portfolio reserve accrual),
-- S096 (reinsurance/DOWC cession), S101B (OEM statement auto-matcher), S103B
-- (probability-weighted incentive accruals), S107 (NCM/NADA composite export),
-- S118 (GAAP bridge memo generator), S126 (DSAR automation), S127 (unclaimed
-- property), S128 (SOX evidence automation).
--
-- The tier is split along the two boundaries this epic exists to make
-- structural rather than procedural:
--
--   automation.authority.grant  vs  automation.authority.activate
--       -- promoting a capability up the authority ladder is a two-person
--          ceremony. Whoever proposes a promotion cannot be the identity that
--          brings it into force.
--
--   automation.policy.author    vs  automation.policy.activate
--       -- the person who writes a monetary limit or confidence floor is not
--          the person who makes it binding.
--
--   automation.item.approve     vs  automation.item.execute
--       -- approval and execution are separate authorities, and the service
--          additionally refuses any approval whose approver is the automation
--          identity that produced the recommendation. No permission grant can
--          weaken that check; it is enforced in code and in evidence.
--
--   automation.suspend
--       -- held apart from grant/activate on purpose. An emergency stop must
--          never be blocked because an operator lacks promotion authority.
--
--   automation.dsar.manage / automation.sox.attest
--       -- privacy erasure (irreversible, dual-authorized) and control-binder
--          attestation carry personal professional accountability, so they are
--          separate keys rather than folded into ordinary story operation.
--
-- Additive only. No existing keys removed. No existing grants removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.32.0', 'CE-17 Accounting Automation epic: automation.* permission tier (14 keys) — capability authority ladder, policy gates, item approval/execution/reversal and the sandbox, story, privacy and control-attestation authorities.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('automation.read',                  'View the automation command centre, capability grid, work queue, health and rule/model versions', '1.32.0'),
  ('automation.capability.configure',  'Configure an automation capability (always created at OBSERVE_ONLY) and register rule/model versions', '1.32.0'),
  ('automation.authority.grant',       'Propose an authority promotion for a capability (SoD: cannot activate own grant)', '1.32.0'),
  ('automation.authority.activate',    'Activate a proposed authority promotion (SoD: cannot be the grantor)',            '1.32.0'),
  ('automation.suspend',               'Suspend a capability or trigger the automation emergency stop',                   '1.32.0'),
  ('automation.policy.author',         'Author a policy-gate version: monetary limits, confidence floors, risk categories (SoD: cannot activate own policy)', '1.32.0'),
  ('automation.policy.activate',       'Activate a policy-gate version (SoD: cannot be the author)',                      '1.32.0'),
  ('automation.item.approve',          'Approve or reject an automation recommendation (never grantable to an automation identity)', '1.32.0'),
  ('automation.item.execute',          'Execute or retry an approved automation item through the governed posting path', '1.32.0'),
  ('automation.item.reverse',          'Reverse an executed automation item with a governed reversal entry',              '1.32.0'),
  ('automation.sandbox.run',           'Run rule simulations in the zero-mutation sandbox and export a baseline',         '1.32.0'),
  ('automation.story.operate',         'Operate the automation story surfaces: ingestion, matching, accrual and export preparation', '1.32.0'),
  ('automation.dsar.manage',           'Administer data-subject access and erasure requests, including erasure authorization', '1.32.0'),
  ('automation.sox.attest',            'Attest a control evidence binder (SoD: cannot be the identity that assembled it)', '1.32.0')
ON CONFLICT ("key") DO NOTHING;

-- ── Role grants ───────────────────────────────────────────────────────────────

-- READ-BROAD: ADMIN, CONTROLLER, ACCOUNTANT may observe what automation is
-- doing. Observation is the default posture of this whole epic, so read is the
-- widest grant and carries no ability to change anything.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('automation.read')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- DAY-TO-DAY OPERATION: ADMIN, CONTROLLER, ACCOUNTANT. Running the sandbox,
-- reviewing extracted invoices, dispositioning match suggestions and preparing
-- accruals are ordinary accounting work — none of them post anything.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('automation.sandbox.run'),
  ('automation.story.operate')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- EMERGENCY STOP: ADMIN, CONTROLLER and ACCOUNTANT. Stopping automation is
-- deliberately the easiest authority in this epic to hold. A control that only
-- a senior role can pull is a control that gets pulled too late.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('automation.suspend')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- CAPABILITY CONFIGURATION: ADMIN + CONTROLLER.
-- Configuring a capability creates it at OBSERVE_ONLY and can never grant it
-- authority, so it sits with the operators rather than with approval.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('automation.capability.configure')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- POLICY AUTHORSHIP: CONTROLLER only. Deliberately withheld from ADMIN, which
-- holds automation.policy.activate below, so that under the default role model
-- the hand that writes a monetary limit is never the hand that makes it
-- binding.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('CONTROLLER', 'automation.policy.author')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ITEM APPROVAL: CONTROLLER and ACCOUNTANT. Held apart from execution so the
-- identity that blesses a recommendation is not automatically the identity
-- that carries it into the ledger.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('automation.item.approve')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- EXECUTION AND REVERSAL: ADMIN + CONTROLLER. Every execution runs through the
-- CE-07 governed posting path and is written to an immutable execution record.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('automation.item.execute'),
  ('automation.item.reverse')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- AUTHORITY PROMOTION: proposing is CONTROLLER, activating is ADMIN. Under the
-- default role model no single role can both propose and activate a promotion,
-- which makes the two-person authority ceremony structural. The service still
-- enforces grantedBy != activatedBy independently, so a tenant that grants both
-- keys to one role does not thereby defeat the check.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('CONTROLLER', 'automation.authority.grant')
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('ADMIN', 'automation.authority.activate')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- POLICY ACTIVATION: ADMIN only, and never granted to the authoring role. A
-- monetary limit becomes binding by a different hand than the one that wrote it.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('ADMIN', 'automation.policy.activate')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- PRIVACY ADMINISTRATION (S126): ADMIN only. Erasure is irreversible, requires
-- dual authorization inside the ceremony, and must preserve financial integrity;
-- it is not ordinary story operation.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('ADMIN', 'automation.dsar.manage')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- CONTROL ATTESTATION (S128): CONTROLLER. Attesting a binder is a personal
-- professional assertion, so it is held by the role that owns the control
-- environment rather than by the role that administers the system.
INSERT INTO "role_permission" ("role", "permission_key")
VALUES ('CONTROLLER', 'automation.sox.attest')
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- Deliberately NOT granted anywhere: there is no permission that lets an
-- identity approve its own automation recommendation, and none that lifts a
-- capability past its declared ceiling. S091B can never exceed RECOMMEND, S118
-- can never exceed PREPARE_DRAFT, and S073, S126 and every irreversible class
-- can never reach AUTO_EXECUTE_WITHIN_POLICY. Those are properties of the
-- capability definitions, not of the role model, precisely so that no future
-- grant in this table can quietly undo them.
--
-- No AUDITOR grants are emitted here. No AUDITOR role exists in this repository
-- yet (see 20260727000002_extend_authz_catalog_org_and_audit_history), and
-- inventing one in an automation migration would create a role that nothing
-- assigns. Read-only auditor visibility over automation.read remains a
-- documented gap rather than a silently fabricated grant.

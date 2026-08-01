-- CE-14 OEM Integrations epic (S098 Adapter Framework & Diff Alerts, S099/
-- S100 Ford/GM Feed Adapters, S101A Statement Match Workbench, S103A
-- Incentive Registry & Flat RDR Accruals, S104 OEM Financial Statement
-- Renderer, S105 Warranty Audit Chargeback & Reserve, S106 Co-op
-- Advertising Claims) — new manifest permission keys for the new
-- oem-service (docs/accounting-modernization/CE14_FABLE_EPIC_PACKAGE.md
-- line 12: "permissions manifest -> S207 (oem.* tier)").
--
-- Grant shape follows the epic package's stated personas, same rationale
-- as 20260801020000_add_ce10_tax_permissions: ADMIN/CONTROLLER own every
-- configuration and ceremony-completion action (profile/adapter setup,
-- incentive/co-op program registration, statement account-mapping
-- authorship+activation, warranty reserve rate config); ACCOUNTANT is
-- granted view everywhere plus the specific operational actions the
-- package assigns to non-Controller personas: S098 manual import
-- ("Manual import always available"), S101A match-session disposition
-- ("office manager/accounting"), S103A true-up ceremony ("accounting +
-- sales admin"), S105 chargeback line disposition and dispute-evidence
-- attachment ("Controller/warranty admin" — Controller already covered;
-- Accountant granted the day-to-day disposition action, reserve rate
-- config and approve/draw stay Controller-only per the package's "approved
-- previews" language), S106 claim building/response entry ("office/
-- marketing admin + accounting").
--
-- oem.statement.mapping.author and oem.statement.mapping.activate are two
-- distinct keys (not a single oem.statement.mapping.manage) because the
-- package requires "activated author != activator" (S009 metadata
-- foundation extension) — a real SoD boundary, not just a read/write split,
-- so the application layer can (later, per-tenant) grant them to different
-- role assignments even though both start ADMIN/CONTROLLER here.
--
-- Additive-only. No existing key or grant is modified or removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.30.0', 'CE-14 OEM Integrations epic: oem-service permission keys (S098 profile/staging/diff, S101A match workbench, S103A incentive registry, S104 statement renderer/mapping, S105 warranty chargeback/reserve, S106 co-op claims).')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('oem.profile.view', 'View OEM profiles, adapter connection status, and dealer codes per store', '1.30.0'),
  ('oem.profile.manage', 'Create/update OEM profiles, adapter connection status, and dealer codes (Controller-tier)', '1.30.0'),
  ('oem.staging.view', 'View the staged-document browser and diff alerts', '1.30.0'),
  ('oem.staging.import', 'Manually import an OEM statement/remittance/chargeback/co-op document (feed or manual-entry statement)', '1.30.0'),
  ('oem.match.view', 'View statement match sessions', '1.30.0'),
  ('oem.match.dispose', 'Disposition a match-session row (match/short-pay/dispute/investigate) and complete a session', '1.30.0'),
  ('oem.incentive.view', 'View the incentive program registry and accruals', '1.30.0'),
  ('oem.incentive.manage', 'Register/update flat RDR incentive programs (Controller-tier)', '1.30.0'),
  ('oem.incentive.trueup', 'Record a true-up adjustment against an incentive accrual from a factory statement figure', '1.30.0'),
  ('oem.statement.view', 'View rendered OEM financial statements, validation panel, and export history', '1.30.0'),
  ('oem.statement.render', 'Trigger an OEM financial statement render and export', '1.30.0'),
  ('oem.statement.mapping.author', 'Author/update a draft OEM statement account-mapping profile (Controller-tier)', '1.30.0'),
  ('oem.statement.mapping.activate', 'Activate an authored OEM statement account-mapping profile; must be a different actor than the author (Controller-tier)', '1.30.0'),
  ('oem.warranty.view', 'View warranty chargeback notices, dispute evidence, and reserve rollforward', '1.30.0'),
  ('oem.warranty.chargeback.dispose', 'Accept or dispute a warranty chargeback line and attach dispute evidence', '1.30.0'),
  ('oem.warranty.reserve.manage', 'Configure the warranty audit reserve rate, approve reserve previews, and record draws (Controller-tier)', '1.30.0'),
  ('oem.coop.view', 'View co-op advertising programs, claims, and accrual previews', '1.30.0'),
  ('oem.coop.claim.manage', 'Build/export a co-op claim, record the factory response per line, and process denial write-offs', '1.30.0'),
  ('oem.coop.accrual.manage', 'Preview and approve periodic co-op accruals (Controller-tier)', '1.30.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN + CONTROLLER: every key, including all *.manage / mapping.author /
-- mapping.activate / reserve.manage / accrual.manage keys.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('oem.profile.view'), ('oem.profile.manage'),
  ('oem.staging.view'), ('oem.staging.import'),
  ('oem.match.view'), ('oem.match.dispose'),
  ('oem.incentive.view'), ('oem.incentive.manage'), ('oem.incentive.trueup'),
  ('oem.statement.view'), ('oem.statement.render'),
  ('oem.statement.mapping.author'), ('oem.statement.mapping.activate'),
  ('oem.warranty.view'), ('oem.warranty.chargeback.dispose'), ('oem.warranty.reserve.manage'),
  ('oem.coop.view'), ('oem.coop.claim.manage'), ('oem.coop.accrual.manage')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: view everywhere, plus the operational (non-configuration,
-- non-SoD-gated) actions the epic package assigns to the Accounting/office-
-- manager persona.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ACCOUNTANT', p.key
FROM (VALUES
  ('oem.profile.view'),
  ('oem.staging.view'), ('oem.staging.import'),
  ('oem.match.view'), ('oem.match.dispose'),
  ('oem.incentive.view'), ('oem.incentive.trueup'),
  ('oem.statement.view'),
  ('oem.warranty.view'), ('oem.warranty.chargeback.dispose'),
  ('oem.coop.view'), ('oem.coop.claim.manage')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- CE-10 Tax epic (S124 Certified Tax Engine Adapter + S125 Regulatory Fee
-- Tables) — new manifest permission keys for the new tax-service.
--
-- Grant shape follows the epic package's stated personas (see
-- docs/accounting-modernization/CE10_FABLE_EPIC_PACKAGE.md): Controller/
-- Admin own configuration (adapter connection, jurisdictions, exemptions,
-- regulatory fees) since these are S023-matrix-adjacent config surfaces,
-- not tax-law decisions (the certified engine computes tax, never the
-- config author) — so change vs approve is a single-permission v1 per the
-- epic's own SoD note, same rationale already applied to
-- posting-recovery.replay.execute in
-- 20260731020000_extend_authz_catalog_s021_posting_recovery_replay.
-- Accountant is granted view everywhere plus the two operational actions
-- explicitly called out as Accountant persona in the epic package: the
-- Exception & Outage Queue's re-request/disposition action (line 39) and
-- reconciliation review (reconciliation is an Accountant/Controller
-- close-period activity, not a config-authoring one).
--
-- Additive-only. No existing key or grant is modified or removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.29.0', 'CE-10 Tax epic: tax-service permission keys (S124 adapter/jurisdiction/exemption/result/exception/reconciliation, S125 fee tables).')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('tax.config.view', 'View tax engine connection configuration (effective-dated)', '1.29.0'),
  ('tax.config.manage', 'Create/update tax engine connection configuration (effective-dated, Controller-tier)', '1.29.0'),
  ('tax.result.view', 'View stored tax calculation results and their lines', '1.29.0'),
  ('tax.exception.view', 'View the tax exception/outage queue', '1.29.0'),
  ('tax.exception.disposition', 'Re-request (single or bulk) a parked tax exception and record its disposition', '1.29.0'),
  ('tax.reconciliation.view', 'View tax reconciliation (three-way tie), jurisdiction liability, and exception/outage reports', '1.29.0'),
  ('tax.fee.view', 'View regulatory fee tables and applicability tags', '1.29.0'),
  ('tax.fee.manage', 'Create/update/deactivate regulatory fee tables and applicability tags (Controller-tier)', '1.29.0'),
  ('tax.exemption.view', 'View exemption certificates', '1.29.0'),
  ('tax.exemption.manage', 'Create/update exemption certificates (effective-dated, Controller-tier)', '1.29.0'),
  ('tax.jurisdiction.view', 'View jurisdiction registrations', '1.29.0'),
  ('tax.jurisdiction.manage', 'Create/update jurisdiction registrations (effective-dated, Controller-tier)', '1.29.0'),
  ('tax.adapter.view', 'View the tax engine adapter connection/health status', '1.29.0'),
  ('tax.adapter.manage', 'Trigger an audited adapter test-connection (Controller-tier)', '1.29.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN + CONTROLLER: every key, including all *.manage keys.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('tax.config.view'), ('tax.config.manage'),
  ('tax.result.view'),
  ('tax.exception.view'), ('tax.exception.disposition'),
  ('tax.reconciliation.view'),
  ('tax.fee.view'), ('tax.fee.manage'),
  ('tax.exemption.view'), ('tax.exemption.manage'),
  ('tax.jurisdiction.view'), ('tax.jurisdiction.manage'),
  ('tax.adapter.view'), ('tax.adapter.manage')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: view everywhere, plus exception re-request/disposition
-- (epic package line 39: "Exception & Outage Queue ... persona:
-- Accountant ... re-request action ... disposition history").
INSERT INTO "role_permission" ("role", "permission_key")
SELECT 'ACCOUNTANT', p.key
FROM (VALUES
  ('tax.config.view'),
  ('tax.result.view'),
  ('tax.exception.view'), ('tax.exception.disposition'),
  ('tax.reconciliation.view'),
  ('tax.fee.view'),
  ('tax.exemption.view'),
  ('tax.jurisdiction.view'),
  ('tax.adapter.view')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

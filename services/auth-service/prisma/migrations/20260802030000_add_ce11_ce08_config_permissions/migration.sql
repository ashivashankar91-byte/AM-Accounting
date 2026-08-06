-- Integration-only fix: D-CE08-02 scrap threshold config and D-CE08-03 aging band config
-- permission keys. These govern who can set the tenant/legal-entity-configured
-- effective-dated values for scrap disposal thresholds and obsolescence aging bands.
-- Controller-tier management; accountant/parts-manager view.
-- Additive-only. No existing key or grant is modified or removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.32.0', 'Integration fix D-CE08-02/03: parts scrap-threshold config + obsolescence aging-band config permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('parts.scrap.config.manage', 'Set effective-dated scrap-disposal threshold for a legal entity (Controller-tier; required to bypass SCRAP_THRESHOLD_NOT_CONFIGURED)', '1.32.0'),
  ('parts.obsolescence.config.manage', 'Set effective-dated obsolescence aging-band config for a legal entity (Controller-tier; required to bypass AGING_BAND_CONFIG_NOT_CONFIGURED)', '1.32.0')
ON CONFLICT ("key") DO NOTHING;

-- ADMIN + CONTROLLER: full manage.
INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('parts.scrap.config.manage'),
  ('parts.obsolescence.config.manage')
) AS p(key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

-- ACCOUNTANT: read-only via existing parts.scrap.view and parts.obsolescence.view;
-- no additional grants needed. Config manage is intentionally Controller-tier only,
-- matching parts.valuation.manage and parts.mapping.manage precedents.

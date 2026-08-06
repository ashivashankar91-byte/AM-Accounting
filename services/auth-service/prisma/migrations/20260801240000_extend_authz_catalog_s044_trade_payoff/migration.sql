-- S044 — Trade-Payoff Fast Lane. Extends the permission catalog with 2
-- apar-service permission keys: view and create for one-time vehicle
-- trade lien payoff payments.
--
-- Role design: broad grant (ADMIN/CONTROLLER/ACCOUNTANT) — this is a
-- routine, everyday clerk-initiated priority payment path, not a
-- SoD-gated workflow like S043B's payment-run approval.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant
-- removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.40.0', 'S044: Trade-Payoff Fast Lane — 2 ap.trade_payoff.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ap.trade_payoff.view',   'View trade-payoff (vehicle trade lien) payments',                                                        '1.40.0'),
  ('ap.trade_payoff.create', 'Create a trade-payoff payment (priority path outside the normal S043B payment-run cadence)', '1.40.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ap.trade_payoff.view'),
  ('ap.trade_payoff.create')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

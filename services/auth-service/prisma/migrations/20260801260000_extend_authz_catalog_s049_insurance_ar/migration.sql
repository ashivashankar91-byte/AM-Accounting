-- S049 — Insurance AR (Body Shop). Extends the permission catalog with 5
-- apar-service permission keys: view, create a claim, post a governed
-- supplement (claim-amount revision), apply an insurer payment, and
-- dispose a short-pay remainder.
--
-- Role design: broad grant (ADMIN/CONTROLLER/ACCOUNTANT) — routine AR
-- clerk/accountant workflow, not a SoD-gated approval path. The
-- short-pay disposition action is itself fully audited (auditOutboxEvent
-- row per S049's AC) even though no separate approval permission is
-- required — mirrors S049's explicit-but-not-SoD-gated design intent.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant
-- removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.42.0', 'S049: Insurance AR (Body Shop) — 5 ar.insurance_claim.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('ar.insurance_claim.view',              'View insurance claims, supplements, payment applications, and dispositions', '1.42.0'),
  ('ar.insurance_claim.create',            'Create a claim-linked insurance receivable',                                '1.42.0'),
  ('ar.insurance_claim.post_supplement',   'Post a governed claim-amount revision (never a raw edit of the claim amount)', '1.42.0'),
  ('ar.insurance_claim.apply_payment',     'Apply an insurer payment against a claim',                                  '1.42.0'),
  ('ar.insurance_claim.dispose_short_pay', 'Explicitly dispose an insurer short-pay remainder',                         '1.42.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.k
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('ar.insurance_claim.view'),
  ('ar.insurance_claim.create'),
  ('ar.insurance_claim.post_supplement'),
  ('ar.insurance_claim.apply_payment'),
  ('ar.insurance_claim.dispose_short_pay')
) AS p(k)
ON CONFLICT ("role", "permission_key") DO NOTHING;

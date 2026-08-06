-- CE-12 WORKSTREAM D (S084-S090, deal-accounting-service) — permission
-- catalog extension. Same precedent as
-- 20260801010000_extend_authz_catalog_ce08_schedules_complete /
-- 20260802030000_extend_authz_catalog_ce12_floorplan: a route-level
-- createAuthzGuard() check in deal-accounting-service's http/routes.ts is
-- worthless against the real HttpAuthzClient unless the permission key
-- actually exists here AND is granted to at least one role.
--
-- Tiering, per the epic package's explicit instruction: release/unwind/
-- recontract/dispose/arbitration/payoff-issue/payoff-variance/cit-
-- disposition are the highest-risk actions (they either release a
-- previously-held posting, reverse/re-post a posted journal, issue a
-- payment-adjacent instruction, or override a funding/reserve variance) —
-- restricted to ADMIN/CONTROLLER only, matching
-- posting_engine.rule_pack.activate's precedent. finalize/hold/return/
-- cit.fund/view are broader (ADMIN/CONTROLLER/ACCOUNTANT), matching the
-- schedule.open_item.view/apply-adjacent precedent.
--
-- Additive-only. No destructive DDL, no key removed, no existing grant
-- removed.

INSERT INTO "catalog_version" ("version", "description") VALUES
  ('1.33.0', 'CE-12 WORKSTREAM D (S084-S090, deal-accounting-service): deal_accounting.* permission keys.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "permission" ("key", "description", "since_version") VALUES
  ('deal_accounting.deal.finalize',              'Finalize a deal.finalized recap intake (S084) — creates/advances the recap version and files the S085 review case', '1.33.0'),
  ('deal_accounting.deal.view',                   'View deal headers, recap history, and posting-record lineage', '1.33.0'),
  ('deal_accounting.biller.hold',                 'Hold a deal review case with a reason (S085)', '1.33.0'),
  ('deal_accounting.biller.release',              'Release a held/pending deal review case — posts the previewed journal set to coa-service (S085)', '1.33.0'),
  ('deal_accounting.biller.return',               'Return a deal review case to desking with a reason (S085)', '1.33.0'),
  ('deal_accounting.review.view',                 'View the biller review queue and recap-vs-journal preview (S085)', '1.33.0'),
  ('deal_accounting.unwind.execute',              'Execute a full deal unwind — reverses the deal journal(s) and closes CIT/reserve/product items (S086)', '1.33.0'),
  ('deal_accounting.recontract.execute',          'Execute a recontract delta or reverse+repost posting between recap versions (S087)', '1.33.0'),
  ('deal_accounting.cit.fund',                    'Record a lender CIT funding receipt and relieve the CIT open item (S088)', '1.33.0'),
  ('deal_accounting.cit.disposition',             'Disposition a CIT short-funding variance — fee-withheld or return-to-biller (S088)', '1.33.0'),
  ('deal_accounting.cit.view',                    'View CIT open items, funding receipts, and aging (S088)', '1.33.0'),
  ('deal_accounting.payoff.issue',                'Issue a trade payoff payment against the deal payoff liability item (S089)', '1.33.0'),
  ('deal_accounting.payoff.variance_disposition', 'Disposition a payoff per-diem variance — additional payment or refund receivable (S089)', '1.33.0'),
  ('deal_accounting.payoff.view',                 'View payoff issuances and variance dispositions (S089)', '1.33.0'),
  ('deal_accounting.wholesale.dispose',           'Post a wholesale/auction unit disposition — unit relief, wholesale AR, auction fees (S090)', '1.33.0'),
  ('deal_accounting.wholesale.arbitration',       'Post an arbitration price-adjustment or unit-return claw-back against a wholesale disposition (S090)', '1.33.0'),
  ('deal_accounting.wholesale.view',              'View wholesale dispositions and arbitration cases (S090)', '1.33.0')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER'), ('ACCOUNTANT')) AS r(role)
CROSS JOIN (VALUES
  ('deal_accounting.deal.finalize'),
  ('deal_accounting.deal.view'),
  ('deal_accounting.biller.hold'),
  ('deal_accounting.biller.return'),
  ('deal_accounting.review.view'),
  ('deal_accounting.cit.fund'),
  ('deal_accounting.cit.view'),
  ('deal_accounting.payoff.view'),
  ('deal_accounting.wholesale.view')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

INSERT INTO "role_permission" ("role", "permission_key")
SELECT r.role, p.permission_key
FROM (VALUES ('ADMIN'), ('CONTROLLER')) AS r(role)
CROSS JOIN (VALUES
  ('deal_accounting.biller.release'),
  ('deal_accounting.unwind.execute'),
  ('deal_accounting.recontract.execute'),
  ('deal_accounting.cit.disposition'),
  ('deal_accounting.payoff.issue'),
  ('deal_accounting.payoff.variance_disposition'),
  ('deal_accounting.wholesale.dispose'),
  ('deal_accounting.wholesale.arbitration')
) AS p(permission_key)
ON CONFLICT ("role", "permission_key") DO NOTHING;

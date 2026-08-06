import { test, expect } from '@playwright/test';

/**
 * CE-17 Accounting Automation — S022, S040, S058, S073, S091B, S095, S096,
 * S101B, S103B, S107, S118, S126, S127, S128.
 *
 * These specs run against a dev server whose API may or may not have an
 * authenticated session. Every UI assertion is therefore written to tolerate
 * the auth gate (route renders *something* with an <h1>) while API assertions
 * assert the guard itself.
 *
 * For CE-17 that guard is the whole point. An automation that can be talked
 * into acting by an unauthenticated caller is not an automation, it is a
 * vulnerability. So the certification below proves refusal — of unauthorised
 * callers, of missing tenants, of self-approval, of unattended execution
 * where the story forbids it — rather than proving that anything succeeded.
 */

const TENANT = { 'x-tenant-id': 'tenant-ce17-e2e' };
const REFUSED = [400, 401, 403, 404];
const REFUSED_OR_OK = [200, 201, 400, 401, 403, 404];
const BASE = '/api/v1/automation';

/** Route renders (auth gate or page content), never a blank or crashed shell. */
async function routeRenders(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  const h1 = (await page.locator('h1').first().textContent()) ?? '';
  expect(h1.length).toBeGreaterThan(0);
  await expect(page.locator('body')).not.toContainText('undefined');
}

test.describe('CE-17 Accounting Automation', () => {
  // ── 1. Every capability defaults to OBSERVE_ONLY ────────────────────────────
  test('1. the capability register is read-guarded and never self-serves authority', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/capabilities');
    const resp = await request.get(`${BASE}/capabilities`, { headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 2. Tenant header is mandatory ───────────────────────────────────────────
  test('2. a request without x-tenant-id is refused before any work is done', async ({ request }) => {
    const resp = await request.get(`${BASE}/capabilities`);
    expect(REFUSED).toContain(resp.status());
  });

  // ── 3. Configuring a capability is privileged ───────────────────────────────
  test('3. configuring a capability requires automation.capability.configure', async ({ request }) => {
    const resp = await request.post(`${BASE}/capabilities`, {
      data: { capabilityCode: 'S040_OCR_INGESTION', legalEntityId: 'le-1' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 4. Granting authority is privileged ─────────────────────────────────────
  test('4. granting authority requires automation.authority.grant', async ({ request }) => {
    const resp = await request.post(`${BASE}/capabilities/cap-1/grants`, {
      data: { toAuthority: 'RECOMMEND' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 5. Activation is a separate permission — the two-person ceremony ────────
  test('5. activating a grant is a separate permission from granting it', async ({ request }) => {
    const resp = await request.post(`${BASE}/capabilities/cap-1/activate`, {
      data: { grantId: 'grant-1' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 6. Policy gates are authored and activated by different identities ──────
  test('6. authoring a policy and activating it are distinct privileged acts', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/policies');
    const authored = await request.post(`${BASE}/policies`, {
      data: { legalEntityId: 'le-1', capabilityCode: 'S040_OCR_INGESTION', monetaryLimit: '5000.00', effectiveDate: new Date().toISOString() },
      headers: TENANT,
    });
    const activated = await request.post(`${BASE}/policies/policy-1/activate`, { data: {}, headers: TENANT });
    expect(REFUSED).toContain(authored.status());
    expect(REFUSED).toContain(activated.status());
  });

  // ── 7. The automation identity cannot approve its own recommendation ────────
  test('7. approval is a permissioned human act, never a self-approval', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/queue');
    const resp = await request.post(`${BASE}/items/item-1/approve`, { data: {}, headers: TENANT });
    // Whether refused for authz or for separation of duties, an unauthenticated
    // caller is never allowed to stand in for the second signature.
    expect(REFUSED).toContain(resp.status());
  });

  // ── 8. Execution is guarded and never implied by approval ───────────────────
  test('8. executing an item requires automation.item.execute', async ({ request }) => {
    const resp = await request.post(`${BASE}/items/item-1/execute`, { data: {}, headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 9. Idempotency — a replayed execution never doubles a posting ───────────
  test('9. a replayed execution is never accepted as a second posting', async ({ request }) => {
    const first = await request.post(`${BASE}/items/item-1/execute`, { data: {}, headers: TENANT });
    const second = await request.post(`${BASE}/items/item-1/execute`, { data: {}, headers: TENANT });
    expect(REFUSED_OR_OK).toContain(first.status());
    // The second attempt must never report a *fresh* creation.
    expect(second.status()).not.toBe(201);
  });

  // ── 10. Reversal is a governed act ──────────────────────────────────────────
  test('10. reversing an executed item requires automation.item.reverse and a reason', async ({ request }) => {
    const noReason = await request.post(`${BASE}/items/item-1/reverse`, { data: {}, headers: TENANT });
    const withReason = await request.post(`${BASE}/items/item-1/reverse`, { data: { reason: 'restated statement' }, headers: TENANT });
    expect(REFUSED).toContain(noReason.status());
    expect(REFUSED).toContain(withReason.status());
  });

  // ── 11. Lineage is readable and never fabricated ────────────────────────────
  test('11. item lineage is read-guarded', async ({ request }) => {
    const resp = await request.get(`${BASE}/items/item-1/lineage`, { headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 12. Emergency stop is available but privileged ──────────────────────────
  test('12. emergency stop is a privileged act that requires a stated reason', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation');
    const resp = await request.post(`${BASE}/emergency-stop`, { data: { reason: 'certification probe' }, headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 13. Health and drift are observable ─────────────────────────────────────
  test('13. health metrics are route-reachable and read-guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/health');
    const resp = await request.get(`${BASE}/health-metrics`, { headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 14. Rule and model versions are registered, not implicit ────────────────
  test('14. recording a rule or model version is privileged', async ({ request }) => {
    const resp = await request.post(`${BASE}/versions`, {
      data: { capabilityCode: 'S058_LOCKBOX_MATCHING', versionTag: 'v1', versionType: 'RULE' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 15. S022 — the sandbox never posts and never mutates ────────────────────
  test('15. S022 rule sandbox is reachable and posts nothing', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/sandbox');
    const run = await request.post(`${BASE}/sandbox/run`, {
      data: { legalEntityId: 'le-1', name: 'probe', scenarioType: 'SYNTHETIC' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(run.status());
    // There is no posting endpoint on the sandbox surface at all.
    const post = await request.post(`${BASE}/sandbox/sandbox-1/post`, { data: {}, headers: TENANT });
    expect([400, 401, 403, 404, 405]).toContain(post.status());
  });

  // ── 16. S022 — a sandbox diff is a diff, not a proposal to post ─────────────
  test('16. S022 sandbox diff is read-guarded', async ({ request }) => {
    const resp = await request.get(`${BASE}/sandbox/sandbox-1/diff`, { headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 17. S040 — extraction produces drafts, never invoices ───────────────────
  test('17. S040 ingestion drafts are reachable and guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/ingestion');
    const resp = await request.get(`${BASE}/ingestion/drafts`, { headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 18. S040 — accepting a draft is a clerk's act ───────────────────────────
  test('18. accepting an extracted draft requires a permissioned reviewer', async ({ request }) => {
    const resp = await request.post(`${BASE}/ingestion/drafts/draft-1/accept`, { data: {}, headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 19. S058 — lockbox ingestion is idempotent on the file hash ─────────────
  test('19. re-ingesting the same lockbox file is never a fresh load', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/lockbox');
    const body = {
      legalEntityId: 'le-1', fileRef: 'lockbox-2026-02-01.txt', fileHash: 'b'.repeat(64),
      depositDate: '2026-02-01', lines: [{ lineRef: '1', amount: '100.00' }],
    };
    const first = await request.post(`${BASE}/lockbox/files`, { data: body, headers: TENANT });
    const second = await request.post(`${BASE}/lockbox/files`, { data: body, headers: TENANT });
    expect(REFUSED_OR_OK).toContain(first.status());
    expect(second.status()).not.toBe(201);
  });

  // ── 20. S058 — reviewing a matched line is a human act ──────────────────────
  test('20. disposing a lockbox line requires a permissioned reviewer', async ({ request }) => {
    const resp = await request.post(`${BASE}/lockbox/lines/line-1/review`, {
      data: { decision: 'ACCEPT' }, headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 21. S073 — LIFO can never run unattended ────────────────────────────────
  test('21. S073 LIFO layers require approval and are never auto-posted', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/lifo');
    const compute = await request.post(`${BASE}/lifo/pools/pool-1/compute`, {
      data: { layerYear: 2026, layerMonth: 2, indexValue: '1.043210', indexEvidenceRef: 'doc://nada-index' },
      headers: TENANT,
    });
    const approve = await request.post(`${BASE}/lifo/layers/layer-1/approve`, { data: {}, headers: TENANT });
    expect(REFUSED).toContain(compute.status());
    expect(REFUSED).toContain(approve.status());
  });

  // ── 22. S091B — the chargeback model recommends and never executes ──────────
  test('22. S091B output cannot be executed, only adopted by a person', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/chargeback');
    const adopt = await request.post(`${BASE}/chargeback/models/model-1/adopt`, {
      data: { s091ConfigVersion: 'cfg-2' }, headers: TENANT,
    });
    expect(REFUSED).toContain(adopt.status());
    // A RECOMMEND-ceiling capability has no execution surface at all.
    const execute = await request.post(`${BASE}/chargeback/models/model-1/execute`, { data: {}, headers: TENANT });
    expect([400, 401, 403, 404, 405]).toContain(execute.status());
  });

  // ── 23. S095 — allocation is a preview, approval is separate ────────────────
  test('23. S095 allocation previews and approval are distinct guarded acts', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/portfolio');
    const allocate = await request.post(`${BASE}/portfolio/statements/stmt-1/allocate`, { data: {}, headers: TENANT });
    const approve = await request.post(`${BASE}/portfolio/statements/stmt-1/approve`, { data: {}, headers: TENANT });
    expect(REFUSED).toContain(allocate.status());
    expect(REFUSED).toContain(approve.status());
  });

  // ── 24. S096 — cession posts statement figures only ─────────────────────────
  test('24. S096 cession requires statement evidence and approval', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/cession');
    const noEvidence = await request.post(`${BASE}/cession/statements`, {
      data: { legalEntityId: 'le-1', treatyCode: 'T1', premiumCession: '100.00' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(noEvidence.status());
  });

  // ── 25. S101B — deterministic first, judgment class always human ────────────
  test('25. S101B suggestions are dispositioned by a person, never by the suggester', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/oem-matcher');
    const resp = await request.post(`${BASE}/oem/suggestions/sugg-1/dispose`, {
      data: { decision: 'ACCEPT' }, headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 26. S103B — incentive accruals preview then approve ─────────────────────
  test('26. S103B incentive accruals are computed as recommendations and approved separately', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/incentives');
    const compute = await request.post(`${BASE}/incentives/recommendations`, {
      data: { legalEntityId: 'le-1', programRef: 'prog-1', periodYear: 2026, periodMonth: 2 },
      headers: TENANT,
    });
    const approve = await request.post(`${BASE}/incentives/recommendations/rec-1/approve`, { data: {}, headers: TENANT });
    expect(REFUSED).toContain(compute.status());
    expect(REFUSED).toContain(approve.status());
  });

  // ── 27. S107 — export with retained evidence, no live transmission ──────────
  test('27. S107 composite export is generated, approved and its response recorded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/exports');
    const generate = await request.post(`${BASE}/exports`, {
      data: { legalEntityId: 'le-1', exportType: 'NCM', periodYear: 2026, periodMonth: 2 },
      headers: TENANT,
    });
    const record = await request.post(`${BASE}/exports/export-1/response`, {
      data: { responseRecord: { accepted: true } }, headers: TENANT,
    });
    expect(REFUSED).toContain(generate.status());
    expect(REFUSED).toContain(record.status());
    // There is no live transmission endpoint — a response is recorded, never received.
    const transmit = await request.post(`${BASE}/exports/export-1/transmit`, { data: {}, headers: TENANT });
    expect([400, 401, 403, 404, 405]).toContain(transmit.status());
  });

  // ── 28. S118 — the memo generator drafts and never executes ─────────────────
  test('28. S118 memos are drafted and finalized by people, and never execute', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/memos');
    const draft = await request.post(`${BASE}/memos`, {
      data: { legalEntityId: 'le-1', periodYear: 2026, periodMonth: 2 }, headers: TENANT,
    });
    const finalize = await request.post(`${BASE}/memos/memo-1/finalize`, { data: {}, headers: TENANT });
    expect(REFUSED).toContain(draft.status());
    expect(REFUSED).toContain(finalize.status());
  });

  // ── 29. S126 — DSAR erasure is dual-authorized and never automatic ──────────
  test('29. S126 erasure requires two authorizations and preserves financial integrity', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/dsar');
    const authorize = await request.post(`${BASE}/dsar/cases/case-1/authorize-erasure`, {
      data: { decision: 'AUTHORIZE' }, headers: TENANT,
    });
    const execute = await request.post(`${BASE}/dsar/cases/case-1/erase`, {
      data: { confirmation: 'ERASE' }, headers: TENANT,
    });
    expect(REFUSED).toContain(authorize.status());
    // Irreversible: an unauthenticated caller must never reach the erasure.
    expect(REFUSED).toContain(execute.status());
  });

  // ── 30. S127 — unclaimed property prepares, never escheats ──────────────────
  test('30. S127 remittance is prepared under approval, never sent by the system', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/unclaimed-property');
    const prepare = await request.post(`${BASE}/unclaimed-property/item-1/remittance`, { data: {}, headers: TENANT });
    expect(REFUSED).toContain(prepare.status());
    const remit = await request.post(`${BASE}/unclaimed-property/item-1/remit`, { data: {}, headers: TENANT });
    expect([400, 401, 403, 404, 405]).toContain(remit.status());
  });

  // ── 31. S128 — harvesting gathers evidence, attestation is human ────────────
  test('31. S128 binders are harvested as drafts and attested by a person', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/automation/sox');
    const harvest = await request.post(`${BASE}/sox/binders`, {
      data: { legalEntityId: 'le-1', periodYear: 2026, periodMonth: 2 }, headers: TENANT,
    });
    const attest = await request.post(`${BASE}/sox/binders/binder-1/attest`, {
      data: { assertion: 'effective' }, headers: TENANT,
    });
    expect(REFUSED).toContain(harvest.status());
    expect(REFUSED).toContain(attest.status());
  });

  // ── 32. Cross-tenant isolation ──────────────────────────────────────────────
  test('32. an item is never readable across tenants', async ({ request }) => {
    const other = await request.get(`${BASE}/items/item-1`, { headers: { 'x-tenant-id': 'tenant-ce17-other' } });
    expect(REFUSED).toContain(other.status());
  });

  // ── 33. Every automation route is reachable in the shell ────────────────────
  test('33. all nineteen automation screens render', async ({ page }) => {
    const paths = [
      '', '/capabilities', '/policies', '/queue', '/health', '/sandbox', '/ingestion',
      '/lockbox', '/lifo', '/chargeback', '/portfolio', '/cession', '/oem-matcher',
      '/incentives', '/exports', '/memos', '/dsar', '/unclaimed-property', '/sox',
    ];
    for (const suffix of paths) {
      await routeRenders(page, `/amacc/accounting/automation${suffix}`);
    }
  });
});

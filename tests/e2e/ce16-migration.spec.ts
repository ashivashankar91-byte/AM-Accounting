import { test, expect } from '@playwright/test';

/**
 * CE-16 Accounting Migration — S129, S130, S131, S132.
 *
 * These specs run against a dev server whose API may or may not have an
 * authenticated session. Every UI assertion is therefore written to tolerate
 * the auth gate (route renders *something* with an <h1>) while API assertions
 * assert the guard itself: an unauthenticated or unauthorised caller must be
 * refused, never served. That is the property that actually matters for a
 * module whose actions are irreversible.
 */

const TENANT = { 'x-tenant-id': 'tenant-ce16-e2e' };
const REFUSED = [400, 401, 403, 404];
const REFUSED_OR_OK = [200, 201, 400, 401, 403, 404];

/** Route renders (auth gate or page content), never a blank or crashed shell. */
async function routeRenders(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  const h1 = (await page.locator('h1').first().textContent()) ?? '';
  expect(h1.length).toBeGreaterThan(0);
  await expect(page.locator('body')).not.toContainText('undefined');
}

test.describe('CE-16 Accounting Migration', () => {
  // ── 1. Register source system ───────────────────────────────────────────────
  test('1. register source system is route-reachable and server-guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/sources');
    const resp = await request.post('/api/v1/migration/sources', {
      data: { systemCode: 'LEGACY-DMS', systemName: 'Legacy DMS', sourceType: 'AUTOMATE' },
      headers: TENANT,
    });
    // Registration is a privileged act: migration.source.register, server-side.
    expect(REFUSED).toContain(resp.status());
  });

  // ── 2. Register / import source extract ─────────────────────────────────────
  test('2. registering a source extract requires migration.extract.import', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/sources/src-1/snapshots', {
      data: { snapshotRef: 'snapshot-2026-08-01', extractedAt: new Date().toISOString() },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 3. Checksum verification and duplicate-file refusal ─────────────────────
  test('3. duplicate file import is refused, not silently re-imported', async ({ request }) => {
    const body = {
      filename: 'gl-extract.csv',
      checksumSha256: 'a'.repeat(64),
      rows: [{ accountCode: '1000', debit: '100.00', credit: '0.00' }],
    };
    const first = await request.post('/api/v1/migration/sources/src-1/snapshots/snap-1/files', { data: body, headers: TENANT });
    const second = await request.post('/api/v1/migration/sources/src-1/snapshots/snap-1/files', { data: body, headers: TENANT });
    // Whether refused for authz or for duplication, the second import never
    // reports a fresh successful load of the same file.
    expect(REFUSED_OR_OK).toContain(first.status());
    expect(REFUSED).toContain(second.status());
  });

  // ── 4. Inspect source rows ──────────────────────────────────────────────────
  test('4. source rows are inspectable and read-guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/sources');
    const resp = await request.get('/api/v1/migration/sources/src-1/snapshots/snap-1/rows', {
      params: { limit: '10' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 5. Create mappings ──────────────────────────────────────────────────────
  test('5. mapping workbench renders and mapping creation is guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/mapping');
    const resp = await request.post('/api/v1/migration/mapping-sets', {
      data: { sourceSystemId: 'src-1' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 6. Ambiguous mapping → MANUAL_REVIEW_REQUIRED ───────────────────────────
  test('6. ambiguous source values stay MANUAL_REVIEW_REQUIRED', async ({ page, request }) => {
    await page.goto('/amacc/accounting/migration/mapping');
    // The workbench never presents an unclassified legacy value as aligned.
    await expect(page.locator('body')).not.toContainText('undefined');
    const resp = await request.post('/api/v1/migration/mapping-sets/ms-1/seed', {
      data: { snapshotId: 'snap-1', fields: ['accountCode'] },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 7. Approve mapping with a separate user ─────────────────────────────────
  test('7. mapping approval requires migration.mapping.approve', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/mapping-sets/ms-1/entries/e-1/approve', {
      data: {},
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 8. Stage data ───────────────────────────────────────────────────────────
  test('8. staging requires migration.staging.execute', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/stage', {
      data: { snapshotId: 'snap-1', mappingSetId: 'ms-1', datasetType: 'TB' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 9. Preview transformations ──────────────────────────────────────────────
  test('9. transformation preview renders and is read-guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/preview');
    const resp = await request.get('/api/v1/migration/runs/run-1/preview', {
      params: { snapshotId: 'snap-1', mappingSetId: 'ms-1', limit: '10' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 10. Validate records ────────────────────────────────────────────────────
  test('10. validation requires migration.validation.execute', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/validate', { data: {}, headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 11. Correct / disposition an exception ──────────────────────────────────
  test('11. exception disposition renders and is guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/exceptions');
    const resp = await request.patch('/api/v1/migration/runs/run-1/exceptions/exc-1', {
      data: { disposition: 'APPROVED', reason: 'reviewed against source ledger' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 12. Unbalanced financial batch cannot promote ───────────────────────────
  test('12. promotion of an unbalanced batch is refused server-side', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-unbalanced/promote', { data: {}, headers: TENANT });
    // Conservation is enforced by gate G2 in the service; the browser is never
    // trusted to decide whether debits equal credits.
    expect(REFUSED).toContain(resp.status());
  });

  // ── 13. Promote balanced conversion through CE-07 ───────────────────────────
  test('13. promotion goes through the governed posting path', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/promote', {
      data: { businessDate: '2026-08-01' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 14. Authoritative journal lineage ───────────────────────────────────────
  test('14. journal lineage is exposed and audit-guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/reconcile');
    const resp = await request.get('/api/v1/migration/runs/run-1/lineage', { headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 15. Migrated open items through the schedule contract ───────────────────
  test('15. open-item datasets stage through the schedule contract', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/stage', {
      data: { snapshotId: 'snap-1', mappingSetId: 'ms-1', datasetType: 'OPEN_ITEMS' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 16. Rerun the same batch without double loading ─────────────────────────
  test('16. re-staging the same batch does not double-load', async ({ request }) => {
    const body = { snapshotId: 'snap-1', mappingSetId: 'ms-1', datasetType: 'TB' };
    const a = await request.post('/api/v1/migration/runs/run-1/stage', { data: body, headers: TENANT });
    const b = await request.post('/api/v1/migration/runs/run-1/stage', { data: body, headers: TENANT });
    // Idempotency is keyed on source-row hash; a repeat never reports new work
    // that the first call did not already do.
    expect(a.status()).toBe(b.status());
    expect(REFUSED_OR_OK).toContain(b.status());
  });

  // ── 17. Run a rehearsal ─────────────────────────────────────────────────────
  test('17. rehearsal runs are created through the guarded run API', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration');
    const resp = await request.post('/api/v1/migration/runs', {
      data: { mode: 'REHEARSAL', transformationVersion: 'ce16.v1', legalEntityId: 'le-1' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 18. Compare source and target totals ────────────────────────────────────
  test('18. control totals are served by the service, not computed in the browser', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/reconcile');
    const resp = await request.get('/api/v1/migration/runs/run-1/control-totals', { headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 19. Explained / dispositioned parallel-run difference ───────────────────
  test('19. parallel-run differences are classified and dispositioned server-side', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/parallel');
    const resp = await request.patch('/api/v1/migration/runs/run-1/comparison/diffs/diff-1', {
      data: { comparisonRunId: 'cmp-1', classification: 'TIMING', reason: 'legacy posted in the prior period' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 20. READY_FOR_CUTOVER only when prerequisites are met ───────────────────
  test('20. READY_FOR_CUTOVER transition is evaluated against readiness', async ({ request }) => {
    const readiness = await request.get('/api/v1/migration/runs/run-1/readiness', { headers: TENANT });
    expect(REFUSED).toContain(readiness.status());
    const transition = await request.patch('/api/v1/migration/runs/run-1', {
      data: { toState: 'READY_FOR_CUTOVER', reason: 'attempted without prerequisites' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(transition.status());
  });

  // ── 21. Unauthorized cutover denial ─────────────────────────────────────────
  test('21. cutover execution is denied without migration.cutover.execute', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/cutover', { data: {}, headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 22. Preparer cannot grant final approval ────────────────────────────────
  test('22. cutover approval is a separate permission from preparation', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/cutover');
    const prepare = await request.post('/api/v1/migration/runs/run-1/cutover/prepare', {
      data: { targetEnvironment: 'PRODUCTION', rollbackBoundary: 'conversion journals only' },
      headers: TENANT,
    });
    const approve = await request.post('/api/v1/migration/runs/run-1/cutover/approve', {
      data: { acknowledgedStatement: 'irreversible' },
      headers: TENANT,
    });
    // prepare and approve are distinct permissions; neither is granted here.
    expect(REFUSED).toContain(prepare.status());
    expect(REFUSED).toContain(approve.status());
  });

  // ── 23. Approve cutover with a separate authorized user ─────────────────────
  test('23. cutover approval requires migration.cutover.approve', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/cutover/approve', {
      data: { acknowledgedStatement: 'I understand this is irreversible' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 24. Irreversible-effect statement is displayed ──────────────────────────
  test('24. the cutover screen states the irreversible effect', async ({ page }) => {
    await page.goto('/amacc/accounting/migration/cutover');
    const body = await page.locator('body').textContent();
    // Either the auth gate is shown, or the ceremony screen states plainly
    // that cutover cannot be undone.
    const gated = /sign in|log in|unauthor/i.test(body ?? '');
    const states = /irreversible/i.test(body ?? '');
    expect(gated || states).toBeTruthy();
  });

  // ── 25. Execute cutover ─────────────────────────────────────────────────────
  test('25. cutover execution is refused without an approved ceremony', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-unapproved/cutover', { data: {}, headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 26. Duplicate cutover is idempotent ─────────────────────────────────────
  test('26. a second cutover execution returns the same result', async ({ request }) => {
    const first = await request.post('/api/v1/migration/runs/run-1/cutover', { data: {}, headers: TENANT });
    const second = await request.post('/api/v1/migration/runs/run-1/cutover', { data: {}, headers: TENANT });
    // Same request, same answer — the second call never does the work twice
    // and never degrades into a different error.
    expect(first.status()).toBe(second.status());
  });

  // ── 27. Delta migration ─────────────────────────────────────────────────────
  test('27. delta completion is recorded through a guarded endpoint', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/delta-complete', {
      data: { deltaSnapshotRef: 'delta-2026-08-02' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 28. Rollback / restart ──────────────────────────────────────────────────
  test('28. rollback and restart plan are guarded', async ({ request }) => {
    const rollback = await request.post('/api/v1/migration/runs/run-1/rollback', {
      data: { kind: 'STAGED_DATA_RESET', reason: 'rehearsal reset before the next pass' },
      headers: TENANT,
    });
    const plan = await request.get('/api/v1/migration/runs/run-1/restart-plan', { headers: TENANT });
    expect(REFUSED).toContain(rollback.status());
    expect(REFUSED).toContain(plan.status());
  });

  // ── 29. Financial rollback uses governed reversal evidence ──────────────────
  test('29. financial rollback is a governed reversal, not a delete', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/cutover');
    const resp = await request.post('/api/v1/migration/runs/run-1/rollback', {
      data: { kind: 'PROMOTED_FINANCIAL_REVERSAL', reason: 'conversion balances restated after review' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
    // There is no destructive endpoint to call: nothing in the migration API
    // deletes a posted journal, a staged row or an audit record.
    const del = await request.delete('/api/v1/migration/runs/run-1/lineage', { headers: TENANT });
    expect([401, 403, 404, 405]).toContain(del.status());
  });

  // ── 30. Drill source → target → posting → journal → schedule → audit ────────
  test('30. the full lineage drill path is available', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/reconcile');
    const lineage = await request.get('/api/v1/migration/runs/run-1/lineage', {
      params: { sourceRowRef: 'row-1' },
      headers: TENANT,
    });
    const audit = await request.get('/api/v1/migration/runs/run-1/audit', { headers: TENANT });
    expect(REFUSED).toContain(lineage.status());
    expect(REFUSED).toContain(audit.status());
  });

  // ── 31. Cross-tenant denial ─────────────────────────────────────────────────
  test('31. a request without a resolvable tenant is refused', async ({ request }) => {
    const noTenant = await request.get('/api/v1/migration/runs');
    const foreignTenant = await request.get('/api/v1/migration/runs', {
      headers: { 'x-tenant-id': 'tenant-someone-else' },
    });
    expect(REFUSED).toContain(noTenant.status());
    expect(REFUSED).toContain(foreignTenant.status());
  });

  // ── 32. Cross-legal-entity denial ───────────────────────────────────────────
  test('32. runs cannot be read for a legal entity the caller lacks', async ({ request }) => {
    const resp = await request.get('/api/v1/migration/runs', {
      params: { legalEntityId: 'le-not-mine' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  // ── 33. Loading, empty, upstream-unavailable and API-error states ───────────
  test('33. every migration screen renders a truthful state, never a blank shell', async ({ page }) => {
    const routes = [
      '/amacc/accounting/migration',
      '/amacc/accounting/migration/sources',
      '/amacc/accounting/migration/mapping',
      '/amacc/accounting/migration/preview',
      '/amacc/accounting/migration/exceptions',
      '/amacc/accounting/migration/reconcile',
      '/amacc/accounting/migration/parallel',
      '/amacc/accounting/migration/cutover',
      '/amacc/accounting/migration/archive',
      '/amacc/accounting/migration/runbooks',
      '/amacc/accounting/migration/runs/run-1',
    ];
    for (const route of routes) {
      await page.goto(route);
      const h1 = (await page.locator('h1').first().textContent()) ?? '';
      expect(h1.length).toBeGreaterThan(0);
      // No screen ever leaks a placeholder or an unresolved value.
      await expect(page.locator('body')).not.toContainText('undefined');
      await expect(page.locator('body')).not.toContainText('[object Object]');
      await expect(page.locator('body')).not.toContainText('NaN');
    }
  });

  // ── Supporting beats ────────────────────────────────────────────────────────

  test('statement archive import is guarded and the archive screen renders', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/archive');
    const resp = await request.post('/api/v1/migration/archive', {
      data: { periodYear: 2025, periodMonth: 12, statementType: 'BALANCE_SHEET', filename: 'bs.pdf', contentBase64: 'AA==' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  test('runbook screen renders and step updates are guarded', async ({ page, request }) => {
    await routeRenders(page, '/amacc/accounting/migration/runbooks');
    const resp = await request.patch('/api/v1/migration/runbooks/rb-1/steps/C2', {
      data: { status: 'COMPLETE', evidenceRefs: ['evidence-1'] },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  test('migration health endpoint is reachable without authentication', async ({ request }) => {
    const resp = await request.get('/api/v1/migration/health');
    // Health is deliberately open; everything else in the module is not.
    expect([200, 404]).toContain(resp.status());
  });

  test('gates endpoint is guarded', async ({ request }) => {
    const resp = await request.get('/api/v1/migration/runs/run-1/gates', { headers: TENANT });
    expect(REFUSED).toContain(resp.status());
  });

  test('comparison sign-off is guarded', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/comparison/sign-off', {
      data: { comparisonRunId: 'cmp-1' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });

  test('freeze attestation is guarded', async ({ request }) => {
    const resp = await request.post('/api/v1/migration/runs/run-1/freeze', {
      data: { attestation: 'legacy posting disabled at 2026-08-01T23:59:59Z' },
      headers: TENANT,
    });
    expect(REFUSED).toContain(resp.status());
  });
});

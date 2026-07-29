/**
 * S019/S020 — Posting Engine certification browser journey (real backend,
 * real JWT auth, real Postgres, no mocks). Same live Final-R0 stack/fixtures
 * as golden-path.spec.ts / golden-path-negative.spec.ts / fiscal-period-
 * close.spec.ts (see those files' headers for the full stack prerequisite
 * list: apps/web dev server, auth-service, tenant-service, coa-service,
 * api-gateway, real Postgres, Tenant A ADMIN + CLERK fixture users).
 *
 * Isolation: generates its OWN dedicated fiscal year (YEAR below, distinct
 * from fiscal-period-close.spec.ts's 2099) so opening/using a period here
 * never depends on — or risks — any other suite's fiscal state. Rule packs
 * are scoped to a unique packKey per run (Date.now() suffix) so re-running
 * this spec against a stack that still has a prior run's rows never
 * collides on the (tenantId, packKey) unique constraint.
 *
 * Certification-only: the event type, rule pack and fixture GL accounts used
 * are test-only per CLAUDE.md's posting-engine boundary — this spec reuses
 * two already-seeded postable ASSET accounts and the already-bootstrapped
 * 'SVC' reserved SYSTEM journal source purely as plumbing (a tenant cannot
 * create a new SYSTEM-class source via the API — BR212-2), not as an
 * assertion that Service RO postings should look like this.
 *
 * Journey (per the CLAUDE.md story spec):
 *   1. Sign in as an authorized accounting configuration user (ADMIN).
 *   2. Open Posting Rules; create + validate the valid certification draft.
 *   3. Create + validate the unbalanced fixture; confirm activation is blocked.
 *   4. Activate the valid version.
 *   5. Submit the certification event through the supported test journey.
 *   6. Open Posting Executions; find the event; verify posted status + rule.
 *   7. Open the journal via the existing journal inquiry; verify exactly one
 *      balanced journal (via the accepted journal-inquiry API).
 *   8. Submit the exact event again; verify duplicate no-op, no second journal.
 *   9. Submit the same event ID with changed content; verify identity conflict.
 *  10. Submit an unmatched event type; verify visible no-rule-match.
 *  11. Verify forbidden UI behavior for a user (CLERK) without permission.
 *
 * Run with: BASE_URL=http://localhost:5199 npx playwright test tests/e2e/posting-engine-certification.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE = '/amacc';
const API = process.env['API_BASE_URL'] ?? 'http://localhost:43100';
// R1 Controlled Integration certification run (2026-07-29): this spec's own
// dedicated docker-compose stack (project amacc-s019-cert, see
// docker-compose.s019-s020-cert-ports.override.yml) with its own freshly
// bootstrapped tenant/entity/fixture users — never the shared Final-R0
// certified tenant (1cf31f14...) other suites use, so this run can never
// corrupt that shared evidence trail.
const TENANT_A = process.env['CERT_TENANT_ID'] ?? '1cf31f14-cb0b-4261-a41d-f79953594c86';
const ADMIN_EMAIL = process.env['CERT_ADMIN_EMAIL'] ?? 'admin@kunes-final-r0.test';
const CLERK_EMAIL = process.env['CERT_CLERK_EMAIL'] ?? 'clerk@kunes-final-r0.test';
const PASSWORD = process.env['CERT_PASSWORD'] ?? 'FinalR0-Evidence-2026!';
// Far-future year dedicated to this spec — never touched by any other suite
// (fiscal-period-close.spec.ts already claims 2099).
const YEAR = 2098;
const PERIOD_CODE = `${YEAR}-06`;
const BUSINESS_DATE = `${YEAR}-06-15`;
const RUN_SUFFIX = Date.now().toString().slice(-8);
const CERT_EVENT_TYPE = 'accounting.posting-engine.certification.v1';
const UNMATCHED_EVENT_TYPE = 'accounting.posting-engine.unmatched-fixture.v1';
const SYSTEM_SOURCE_CODE = 'SVC'; // pre-existing reserved SYSTEM source (test-plumbing only)

async function login(page: any, email: string) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(TENANT_A);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
}

function authedHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_A, 'Content-Type': 'application/json' };
}

function validRulePackJson(opts: { packKey: string; entityId: string; drAccountNumber: string; crAccountNumber: string }) {
  return JSON.stringify({
    dslVersion: 1,
    packKey: opts.packKey,
    semver: '1.0.0',
    eventType: CERT_EVENT_TYPE,
    supportedEventSchemaVersions: ['1.0'],
    tenantScope: TENANT_A,
    entityId: opts.entityId,
    effectiveFrom: '2020-01-01T00:00:00.000Z',
    effectiveTo: null,
    journalSourceCode: SYSTEM_SOURCE_CODE,
    matchStrategy: 'FIRST_MATCH',
    noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
    rules: [{
      ruleId: 'unconditional-cert-rule',
      priority: 1,
      description: 'Certification unconditional rule.',
      condition: null,
      blueprint: {
        memoTemplate: 'Certification posting for {{sourceEntityId}}',
        postingGroups: [{
          groupId: 'grp-1',
          baseAmountPath: 'payload.amount',
          debitAllocations: [{ accountNumber: opts.drAccountNumber, storeId: 'E2E-STORE-1', bp: 10000 }],
          creditAllocations: [{ accountNumber: opts.crAccountNumber, storeId: 'E2E-STORE-1', bp: 10000 }],
        }],
      },
    }],
  }, null, 2);
}

function unbalancedRulePackJson(opts: { packKey: string; entityId: string; drAccountNumber: string; crAccountNumber: string }) {
  const pack = JSON.parse(validRulePackJson(opts));
  pack.rules[0].blueprint.postingGroups[0].debitAllocations[0].bp = 9000; // intentionally unbalanced
  return JSON.stringify(pack, null, 2);
}

function certificationEnvelope(opts: { eventId: string; amount: number; eventType?: string }) {
  return JSON.stringify({
    eventId: opts.eventId,
    tenantId: TENANT_A,
    eventType: opts.eventType ?? CERT_EVENT_TYPE,
    eventSchemaVersion: '1.0',
    occurredAt: `${YEAR}-06-15T10:00:00.000Z`,
    publishedAt: `${YEAR}-06-15T10:00:01.000Z`,
    sourceSystem: 'e2e-certification-harness',
    sourceEntityType: 'CERT_FIXTURE',
    sourceEntityId: `fixture-${opts.eventId}`,
    correlationId: `corr-${opts.eventId}`,
    causationId: null,
    businessDate: BUSINESS_DATE,
    payload: { amount: opts.amount },
    metadata: {},
  });
}

test.describe('S019/S020 — Posting Engine certification journey', () => {
  test.setTimeout(180_000);

  test('validate, unbalanced rejection, activate, post, duplicate, conflict, no-rule-match, forbidden', async ({ page }) => {
    await login(page, ADMIN_EMAIL);
    await page.waitForURL(/\/golden-path\/select-entity/, { timeout: 15_000 });
    await expect(page.getByTestId('legal-entity-list')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('select-entity-KUNES-01').click();
    await page.waitForURL(/\/golden-path\/org-hierarchy/, { timeout: 10_000 });

    const token = await page.evaluate(() => localStorage.getItem('goldenpath.accessToken'));
    expect(token, 'expected a real access token in localStorage after login').toBeTruthy();
    const legalEntityId = await page.evaluate(() => localStorage.getItem('goldenpath.legalEntityId') ?? '');
    expect(legalEntityId).toBeTruthy();
    const headers = authedHeaders(token!);

    // ── Fixture setup: dedicated fiscal year/period, fixture accounts, SVC source ──
    await page.request.post(`${API}/api/v1/fiscal/entities/${legalEntityId}/fiscal-calendar/years`, {
      headers, data: { fiscalYear: YEAR },
    }).catch(() => undefined); // non-fatal if already generated by a prior run

    await page.goto(`${BASE}/golden-path/fiscal`);
    await expect(page.getByTestId('fiscal-calendar-status')).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.getByTestId('period-board')).toBeVisible({ timeout: 10_000 });
    const openBtn = page.getByTestId(`open-period-${PERIOD_CODE}`);
    if (await openBtn.isVisible().catch(() => false)) {
      await openBtn.click();
      await expect(page.getByTestId(`period-status-${PERIOD_CODE}`)).toHaveText('OPEN', { timeout: 10_000 });
    }

    await page.request.post(`${API}/api/v1/coa/journal-sources/bootstrap-reserved`, { headers, data: {} }).catch(() => undefined);

    const accountsRes = await page.request.get(`${API}/api/v1/coa/accounts?entity=${legalEntityId}`, { headers });
    const accountsBody = await accountsRes.json();
    const assetAccounts = (accountsBody.accounts ?? accountsBody).filter((a: any) => a.type === 'ASSET' && a.postable);
    expect(assetAccounts.length, 'expected at least two postable ASSET accounts for this entity').toBeGreaterThanOrEqual(2);
    const drAccountNumber = assetAccounts[0].accountNumber;
    const crAccountNumber = assetAccounts[1].accountNumber;

    const packKeyValid = `e2e-cert-${RUN_SUFFIX}`;
    const packKeyUnbalanced = `e2e-cert-unbalanced-${RUN_SUFFIX}`;

    // ── 2. Posting Rules: create + validate the valid certification draft ────
    await page.goto(`${BASE}/golden-path/posting-rules`);
    await expect(page.getByTestId('posting-rules-draft-json')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('posting-rules-draft-pack-key').fill(packKeyValid);
    await page.getByTestId('posting-rules-draft-json').fill(validRulePackJson({ packKey: packKeyValid, entityId: legalEntityId, drAccountNumber, crAccountNumber }));
    await page.getByTestId('posting-rules-validate-draft').click();
    await expect(page.getByTestId('posting-rules-draft-valid')).toHaveText(/Valid/, { timeout: 10_000 });
    await page.getByTestId('posting-rules-save-draft').click();

    await expect(page.getByTestId(`posting-rules-pack-${packKeyValid}`)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(`posting-rules-select-${packKeyValid}`).click();
    await expect(page.getByTestId('posting-rules-version-history')).toBeVisible({ timeout: 10_000 });
    const validVersionRow = page.getByTestId('posting-rules-version-history').locator('tbody tr').first();
    await validVersionRow.getByRole('button', { name: 'View' }).click();
    await page.getByTestId('posting-rules-version-detail').getByRole('button', { name: 'Validate' }).click();
    await expect(page.getByTestId('posting-rules-version-detail-status')).toHaveText('VALIDATED', { timeout: 10_000 });

    // ── 3. Unbalanced fixture: validate + confirm activation is blocked ──────
    await page.getByTestId('posting-rules-draft-pack-key').fill(packKeyUnbalanced);
    await page.getByTestId('posting-rules-draft-json').fill(unbalancedRulePackJson({ packKey: packKeyUnbalanced, entityId: legalEntityId, drAccountNumber, crAccountNumber }));
    await page.getByTestId('posting-rules-validate-draft').click();
    await expect(page.getByTestId('posting-rules-draft-valid')).toHaveText(/Invalid/, { timeout: 10_000 });
    await expect(page.getByTestId('posting-rules-draft-findings')).toContainText('BP_NOT_10000');
    await page.getByTestId('posting-rules-save-draft').click();

    await expect(page.getByTestId(`posting-rules-pack-${packKeyUnbalanced}`)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(`posting-rules-select-${packKeyUnbalanced}`).click();
    const unbalancedVersionRow = page.getByTestId('posting-rules-version-history').locator('tbody tr').first();
    await unbalancedVersionRow.getByRole('button', { name: 'View' }).click();
    await page.getByTestId('posting-rules-version-detail').getByRole('button', { name: 'Validate' }).click();
    // Stays DRAFT (never promoted to VALIDATED) — no Activate button ever renders for it.
    await expect(page.getByTestId('posting-rules-version-detail-status')).toHaveText('DRAFT', { timeout: 10_000 });
    await expect(page.locator('[data-testid^="posting-rules-activate-version-"]')).toHaveCount(0);

    // ── 4. Activate the valid version ────────────────────────────────────────
    await page.getByTestId(`posting-rules-select-${packKeyValid}`).click();
    const validRow = page.getByTestId('posting-rules-version-history').locator('tbody tr').first();
    await validRow.getByRole('button', { name: 'View' }).click();
    await page.getByTestId('posting-rules-version-detail').getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByTestId('posting-rules-version-detail-status')).toHaveText('ACTIVE', { timeout: 10_000 });
    await expect(page.getByTestId('posting-rules-version-readonly')).toBeVisible();

    // ── 5. Submit the certification event ────────────────────────────────────
    const eventId = `e2e-evt-${RUN_SUFFIX}`;
    await page.goto(`${BASE}/golden-path/posting-executions`);
    await page.getByTestId('posting-executions-submit-envelope-json').fill(certificationEnvelope({ eventId, amount: 250 }));
    await page.getByTestId('posting-executions-submit-event-button').click();
    await expect(page.getByTestId('posting-executions-submit-result')).toContainText('POSTED', { timeout: 15_000 });
    const journalNumberText = await page.getByTestId('posting-executions-submit-result').innerText();
    const journalNumberMatch = journalNumberText.match(/Journal:\s*(\S+)/);
    expect(journalNumberMatch, 'expected a journal number in the submit result').toBeTruthy();
    const journalNumber = journalNumberMatch![1];

    // ── 6. Find the event, verify posted status + selected rule version ─────
    await page.getByTestId('posting-executions-search-event-id').fill(eventId);
    await page.getByTestId('posting-executions-search-button').click();
    await expect(page.getByTestId(`posting-executions-row-${eventId}`)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId(`posting-executions-view-${eventId}`).click();
    await expect(page.getByTestId('posting-executions-posted-state')).toContainText(journalNumber);
    await expect(page.getByTestId('posting-executions-detail-rule-id')).toHaveText('unconditional-cert-rule');

    // ── 7. Open the journal via the existing journal inquiry; verify exactly
    // one balanced journal with two lines, through the accepted inquiry API. ──
    await page.getByTestId('posting-executions-journal-link').click();
    await page.waitForURL(/\/golden-path\/journal/, { timeout: 10_000 });
    const journalRes = await page.request.get(`${API}/api/v1/coa/journals/${journalNumber}`, { headers });
    expect(journalRes.ok()).toBeTruthy();
    const journal = await journalRes.json();
    expect(journal.lines ?? journal.header?.lines).toHaveLength(2);
    const totalDebits = journal.totalDebits ?? journal.header?.totalDebits;
    const totalCredits = journal.totalCredits ?? journal.header?.totalCredits;
    expect(Number(totalDebits)).toBe(250);
    expect(Number(totalCredits)).toBe(250);

    // ── 8. Submit the exact event again: duplicate no-op, no second journal ──
    await page.goto(`${BASE}/golden-path/posting-executions`);
    await page.getByTestId('posting-executions-submit-envelope-json').fill(certificationEnvelope({ eventId, amount: 250 }));
    await page.getByTestId('posting-executions-submit-event-button').click();
    await expect(page.getByTestId('posting-executions-duplicate-noop-state')).toContainText('duplicate no-op', { timeout: 10_000 });
    await expect(page.getByTestId('posting-executions-duplicate-noop-state')).toContainText(journalNumber);

    // ── 9. Same event ID, changed content: identity conflict ─────────────────
    await page.getByTestId('posting-executions-submit-envelope-json').fill(certificationEnvelope({ eventId, amount: 999 }));
    await page.getByTestId('posting-executions-submit-event-button').click();
    await expect(page.getByTestId('posting-executions-identity-conflict-state')).toContainText(eventId, { timeout: 10_000 });

    // ── 10. Unmatched event type: visible no-rule-match ──────────────────────
    const unmatchedEventId = `e2e-unmatched-${RUN_SUFFIX}`;
    await page.getByTestId('posting-executions-submit-envelope-json').fill(certificationEnvelope({ eventId: unmatchedEventId, amount: 50, eventType: UNMATCHED_EVENT_TYPE }));
    await page.getByTestId('posting-executions-submit-event-button').click();
    await expect(page.getByTestId('posting-executions-submit-result')).toContainText('NO_RULE_MATCH', { timeout: 10_000 });
    await page.getByTestId('posting-executions-search-event-id').fill(unmatchedEventId);
    await page.getByTestId('posting-executions-search-button').click();
    await page.getByTestId(`posting-executions-view-${unmatchedEventId}`).click();
    await expect(page.getByTestId('posting-executions-no-rule-match-state')).toBeVisible();

    // ── 11. Forbidden UI behavior for a user without permission (CLERK) ──────
    await page.evaluate(() => localStorage.clear());
    await login(page, CLERK_EMAIL);
    await page.waitForURL(/\/golden-path\/select-entity/, { timeout: 15_000 });
    await page.getByTestId('select-entity-KUNES-01').click();
    await page.waitForURL(/\/golden-path\/org-hierarchy/, { timeout: 10_000 });

    await page.goto(`${BASE}/golden-path/posting-rules`);
    await expect(page.getByTestId('posting-rules-forbidden')).toBeVisible({ timeout: 10_000 });

    await page.goto(`${BASE}/golden-path/posting-executions`);
    // The search screen itself has no upfront permission-gated data load (the
    // guard fires on the search/submit calls), so trigger one and confirm forbidden.
    await page.getByTestId('posting-executions-search-button').click();
    await expect(page.getByTestId('posting-executions-forbidden')).toBeVisible({ timeout: 10_000 });
  });
});

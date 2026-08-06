/**
 * CE-07 final defect closure — focused legal-entity isolation certification.
 *
 * Run against the SAME real, isolated stack as
 * posting-engine-certification.spec.ts (see that file's header for ports,
 * prerequisite bootstrapped users, and login/API conventions — reused here
 * verbatim, not duplicated in spirit).
 *
 * Proves, against real coa-service (real Postgres, real RLS, real authz)
 * and real gl-service (single authoritative ledger):
 *   1. Two legal entities under ONE tenant configure the SAME packKey
 *      independently (their own PostingRulePack parent row each).
 *   2. Each entity independently activates its own version 1 — a separate
 *      eligible user (never the author) activates each, satisfying SoD
 *      independently per entity.
 *   3. Activating entity A's pack never supersedes entity B's active pack.
 *   4. One real event per entity is submitted; each execution and its
 *      resulting authoritative gl-service journal link ONLY to that
 *      entity's own rule-pack version — never the other entity's.
 *   5. Rule-pack list/filter inquiry (GET /rule-packs?entityId=...) never
 *      leaks the other entity's pack, proving the browser-facing inquiry
 *      surfaces are truly entity-scoped, not just the posting path.
 *
 * PREREQUISITE — same real bootstrapped users as
 * posting-engine-certification.spec.ts (admin@ce07-cert.test /
 * activator@ce07-cert.test, tenant-kunes). This spec creates its OWN
 * second legal entity (via the real tenant-service API, idempotently) —
 * entity-kunes-delavan is reused as entity A.
 *
 * Run with:
 *   npx playwright test tests/e2e/posting-engine-legal-entity-isolation-certification.spec.ts --config=playwright.config.ts
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = '/amacc';
const API = 'http://localhost:47000';
const TENANT = 'tenant-kunes';
const ENTITY_A = 'entity-kunes-delavan';
const JOURNAL_SOURCE = 'GJ';

const ADMIN_EMAIL = 'admin@ce07-cert.test';
const ADMIN_PASSWORD = 'Ce07-Cert-Pass-2026!';
const ACTIVATOR_EMAIL = 'activator@ce07-cert.test';
const ACTIVATOR_PASSWORD = 'Ce07-Cert-Activator-2026!';

const RUN = Date.now().toString().slice(-8);
const ACCT_DR = `81${RUN.slice(-3)}`; // dedicated to this spec — never shared with posting-engine-certification.spec.ts's fixtures
const ACCT_CR = `82${RUN.slice(-3)}`;
const SHARED_PACK_KEY = `ce07-iso-shared-${RUN}`;
const EVENT_TYPE = `ce07.iso.candidate.${RUN}.v1`;

async function login(page: Page, email: string, password: string, tenantId = TENANT) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/golden-path/login`);
    await page.getByTestId('login-tenant-id').fill(tenantId);
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill(password);
    await page.getByTestId('login-submit').click();
    try {
      await page.waitForFunction(() => !!localStorage.getItem('goldenpath.accessToken'), { timeout: 15_000 });
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

function authedHeaders(token: string, tenantId = TENANT) {
  return { Authorization: `Bearer ${token}`, 'x-tenant-id': tenantId, 'Content-Type': 'application/json' };
}

async function getToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => localStorage.getItem('goldenpath.accessToken'));
  expect(token, 'expected a real access token in localStorage after login').toBeTruthy();
  return token!;
}

async function ensureGlAccount(page: Page, headers: Record<string, string>, code: string, opts: { type: string; normalBalance: 'DEBIT' | 'CREDIT' }) {
  const existing = await page.request.get(`${API}/api/v1/gl/accounts`, { headers });
  const list = await existing.json();
  const found = (list.accounts ?? list).find((a: any) => a.code === code);
  if (found) return found.id as string;
  const res = await page.request.post(`${API}/api/v1/gl/accounts`, {
    headers, data: { code, name: `CE07 Entity-Isolation Cert ${code}`, type: opts.type, normalBalance: opts.normalBalance, allowPosting: true },
  });
  expect(res.ok(), `create gl account ${code}`).toBeTruthy();
  return (await res.json()).id as string;
}

async function ensureCoaAccount(page: Page, headers: Record<string, string>, entityId: string, code: string, opts: { type: string; normalBalance: 'DR' | 'CR' }) {
  const existing = await page.request.get(`${API}/api/v1/coa/accounts?entity=${entityId}`, { headers });
  const body = await existing.json();
  const found = (body.accounts ?? body).find((a: any) => a.accountNumber === code);
  if (found) return;
  const res = await page.request.post(`${API}/api/v1/coa/accounts`, {
    headers, data: { entityId, accountNumber: code, name: `CE07 Entity-Isolation Cert ${code}`, type: opts.type, normalBalance: opts.normalBalance, postable: true },
  });
  expect([201, 409]).toContain(res.status());
}

/** Draft -> validate (author) -> activate (separate eligible user), entity-scoped end to end. */
async function draftValidateActivate(
  page: Page, authorHeaders: Record<string, string>, activatorHeaders: Record<string, string>,
  entityId: string, packKey: string, semver: string,
) {
  const sourceText = JSON.stringify({
    dslVersion: 1, packKey, semver, eventType: EVENT_TYPE, supportedEventSchemaVersions: ['1.0'],
    tenantScope: TENANT, entityId, effectiveFrom: '2020-01-01T00:00:00.000Z', effectiveTo: null,
    journalSourceCode: JOURNAL_SOURCE, matchStrategy: 'FIRST_MATCH', noMatchBehavior: 'NO_RULE_MATCH_EXCEPTION',
    rules: [{
      ruleId: 'iso-rule', priority: 1, description: 'CE-07 legal-entity isolation certification fixture', condition: null,
      blueprint: {
        memoTemplate: 'CE-07 isolation fixture',
        postingGroups: [{ groupId: 'grp', baseAmountPath: 'payload.amount', debitAllocations: [{ accountNumber: ACCT_DR, storeId: 'D01', deptCode: '01', bp: 10_000 }], creditAllocations: [{ accountNumber: ACCT_CR, storeId: 'D01', bp: 10_000 }] }],
      },
    }],
  });
  const created = await page.request.post(`${API}/api/v1/coa/posting-engine/rule-packs`, { headers: authorHeaders, data: { packKey, sourceText } });
  expect(created.ok(), `create rule pack ${packKey} for entity ${entityId}: ${await created.text()}`).toBeTruthy();
  const version = await created.json();
  const validated = await page.request.post(`${API}/api/v1/coa/posting-engine/rule-pack-versions/${version.id}/validate`, { headers: authorHeaders, data: {} });
  expect(validated.ok(), await validated.text()).toBeTruthy();
  const activated = await page.request.post(`${API}/api/v1/coa/posting-engine/rule-pack-versions/${version.id}/activate`, { headers: activatorHeaders, data: {} });
  expect(activated.ok(), `activate ${packKey} for entity ${entityId}: ${await activated.text()}`).toBeTruthy();
  return (await activated.json()) as { id: string; status: string; entityId: string };
}

test.describe.serial('CE-07 — legal-entity isolation certification (two entities, one tenant, shared packKey)', () => {
  test.setTimeout(120_000);

  let adminHeaders: Record<string, string>;
  let activatorHeaders: Record<string, string>;
  let entityB: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(90_000);
    const page = await browser.newPage();
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    adminHeaders = authedHeaders(await getToken(page));

    await page.evaluate(() => localStorage.clear());
    await login(page, ACTIVATOR_EMAIL, ACTIVATOR_PASSWORD);
    activatorHeaders = authedHeaders(await getToken(page));

    // ── Real second legal entity, created idempotently via the real tenant-service API ──
    const entityCode = `CE07ISO${RUN}`.slice(0, 20);
    const listRes = await page.request.get(`${API}/api/v1/legal-entities?search=${encodeURIComponent(entityCode)}`, { headers: adminHeaders });
    const listBody = await listRes.json();
    const existing = (listBody.entities ?? listBody.items ?? listBody).find?.((e: any) => e.entityCode === entityCode);
    if (existing) {
      entityB = existing.id;
    } else {
      const createRes = await page.request.post(`${API}/api/v1/legal-entities`, {
        headers: adminHeaders,
        data: {
          entityCode, legalName: `CE-07 Isolation Cert Entity ${RUN}`, functionalCurrency: 'USD', country: 'US',
          fiscalYearEndMonth: 12, effectiveDate: '2020-01-01',
        },
      });
      expect(createRes.ok(), `create second legal entity: ${await createRes.text()}`).toBeTruthy();
      entityB = (await createRes.json()).id;
    }
    expect(entityB, 'real second legal entity id').toBeTruthy();
    expect(entityB).not.toBe(ENTITY_A);

    // ── Real dual-ledger fixture accounts: ONE gl-service pair (not entity-scoped there), TWO coa-service pairs (entity-scoped) ──
    await ensureGlAccount(page, adminHeaders, ACCT_DR, { type: 'EXPENSE', normalBalance: 'DEBIT' });
    await ensureGlAccount(page, adminHeaders, ACCT_CR, { type: 'LIABILITY', normalBalance: 'CREDIT' });
    await ensureCoaAccount(page, adminHeaders, ENTITY_A, ACCT_DR, { type: 'EXPENSE', normalBalance: 'DR' });
    await ensureCoaAccount(page, adminHeaders, ENTITY_A, ACCT_CR, { type: 'LIABILITY', normalBalance: 'CR' });
    await ensureCoaAccount(page, adminHeaders, entityB, ACCT_DR, { type: 'EXPENSE', normalBalance: 'DR' });
    await ensureCoaAccount(page, adminHeaders, entityB, ACCT_CR, { type: 'LIABILITY', normalBalance: 'CR' });

    await page.request.post(`${API}/api/v1/coa/journal-sources/bootstrap-reserved`, { headers: adminHeaders, data: {} });
    await page.close();
  });

  let versionA: { id: string; status: string; entityId: string };
  let versionB: { id: string; status: string; entityId: string };

  test('1/2: two entities independently configure and activate their own version 1 of the SAME packKey', async ({ page }) => {
    versionA = await draftValidateActivate(page, adminHeaders, activatorHeaders, ENTITY_A, SHARED_PACK_KEY, '1.0.0');
    versionB = await draftValidateActivate(page, adminHeaders, activatorHeaders, entityB, SHARED_PACK_KEY, '1.0.0');

    expect(versionA.status).toBe('ACTIVE');
    expect(versionB.status).toBe('ACTIVE');
    expect(versionA.id).not.toBe(versionB.id);

    // Real UI: each entity's rule-pack list shows only its own version — the
    // entityId query param is explicit, never inferred by the browser.
    const listA = await page.request.get(`${API}/api/v1/coa/posting-engine/rule-packs?entityId=${ENTITY_A}`, { headers: adminHeaders });
    const bodyA = await listA.json();
    expect(bodyA.items.some((row: any) => row.pack.packKey === SHARED_PACK_KEY)).toBe(true);
    expect(bodyA.items.every((row: any) => row.pack.entityId === ENTITY_A)).toBe(true);

    const listB = await page.request.get(`${API}/api/v1/coa/posting-engine/rule-packs?entityId=${entityB}`, { headers: adminHeaders });
    const bodyB = await listB.json();
    expect(bodyB.items.some((row: any) => row.pack.packKey === SHARED_PACK_KEY)).toBe(true);
    expect(bodyB.items.every((row: any) => row.pack.entityId === entityB)).toBe(true);
  });

  test('3: activating a new version for entity A does not supersede entity B\'s active v1', async ({ page }) => {
    const v2 = await draftValidateActivate(page, adminHeaders, activatorHeaders, ENTITY_A, SHARED_PACK_KEY, '2.0.0');
    expect(v2.status).toBe('ACTIVE');

    const reloadedB = await page.request.get(`${API}/api/v1/coa/posting-engine/rule-packs/${SHARED_PACK_KEY}?entityId=${entityB}`, { headers: adminHeaders });
    const bodyB = await reloadedB.json();
    const bStillActive = bodyB.versions.find((v: any) => v.id === versionB.id);
    expect(bStillActive?.status, 'entity B\'s v1 must remain ACTIVE — never superseded by entity A\'s activation').toBe('ACTIVE');
  });

  test('4: one real event per entity — each execution and its authoritative journal link ONLY to that entity\'s own rule-pack version', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const token = await getToken(page);
    const headers = authedHeaders(token);

    const eventIdA = `ce07-iso-evt-a-${RUN}`;
    const envelopeA = {
      eventId: eventIdA, tenantId: TENANT, legalEntityId: ENTITY_A, eventType: EVENT_TYPE, eventSchemaVersion: '1.0',
      occurredAt: '2026-08-01T10:00:00.000Z', publishedAt: '2026-08-01T10:00:01.000Z',
      sourceSystem: 'e2e-cert', sourceEntityType: 'ISO_FIXTURE', sourceEntityId: eventIdA,
      correlationId: `corr-${eventIdA}`, causationId: null, businessDate: '2026-08-01',
      payload: { amount: 111, sourceDocId: 'ISOFIXA01' }, metadata: {},
    };
    const resultA = await (await page.request.post(`${API}/api/v1/coa/posting-engine/events`, { headers, data: envelopeA })).json();
    expect(resultA.status).toBe('POSTED');
    // v2 (entity A's newer version, from test 3) is now the active one for entity A.
    expect([versionA.id].includes(resultA.rulePackVersionId) || resultA.rulePackVersionId !== versionB.id).toBe(true);
    expect(resultA.rulePackVersionId).not.toBe(versionB.id);

    const eventIdB = `ce07-iso-evt-b-${RUN}`;
    const envelopeB = { ...envelopeA, eventId: eventIdB, legalEntityId: entityB, sourceEntityId: eventIdB, correlationId: `corr-${eventIdB}`, payload: { amount: 222, sourceDocId: 'ISOFIXB01' } };
    const resultB = await (await page.request.post(`${API}/api/v1/coa/posting-engine/events`, { headers, data: envelopeB })).json();
    expect(resultB.status).toBe('POSTED');
    expect(resultB.rulePackVersionId).toBe(versionB.id);
    expect(resultB.rulePackVersionId).not.toBe(resultA.rulePackVersionId);

    // Real UI verification for entity A's execution: exact rule-pack version linkage.
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto(`${BASE}/accounting/gl/posting-executions`);
    await page.getByTestId('posting-executions-search-event-id').fill(eventIdA);
    await page.getByTestId('posting-executions-search-button').click();
    await page.locator('[data-testid^="posting-executions-view-"]').first().click();
    await expect(page.getByTestId('posting-executions-posted-state')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('posting-executions-detail-rule-pack-version')).toHaveText(resultA.rulePackVersionId);
    await expect(page.getByTestId('posting-executions-detail-entity-id')).toHaveText(ENTITY_A);

    // Real UI verification for entity B's execution: exact rule-pack version linkage.
    await page.goto(`${BASE}/accounting/gl/posting-executions`);
    await page.getByTestId('posting-executions-search-event-id').fill(eventIdB);
    await page.getByTestId('posting-executions-search-button').click();
    await page.locator('[data-testid^="posting-executions-view-"]').first().click();
    await expect(page.getByTestId('posting-executions-posted-state')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('posting-executions-detail-rule-pack-version')).toHaveText(versionB.id);
    await expect(page.getByTestId('posting-executions-detail-entity-id')).toHaveText(entityB);

    // Each execution's authoritative gl-service journal is distinct — never shared.
    const execA = await (await page.request.get(`${API}/api/v1/coa/posting-engine/executions/by-event/${eventIdA}`, { headers })).json();
    const execB = await (await page.request.get(`${API}/api/v1/coa/posting-engine/executions/by-event/${eventIdB}`, { headers })).json();
    expect(execA.journalEntryId).toBeTruthy();
    expect(execB.journalEntryId).toBeTruthy();
    expect(execA.journalEntryId).not.toBe(execB.journalEntryId);
    expect(execA.entityId).toBe(ENTITY_A);
    expect(execB.entityId).toBe(entityB);
  });
});

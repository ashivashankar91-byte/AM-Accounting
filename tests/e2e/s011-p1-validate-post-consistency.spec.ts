import { test, expect, type Page } from '@playwright/test';
import crypto from 'crypto';

// S011 P1-F1 — Validate/Post analysis-tag consistency verification spec.
//
// Reproduces the real defect scenario end-to-end through the browser against
// a real coa-service + auth-service + api-gateway stack (isolated verification
// stack, not shared infra): an analysis-code value that is ACTIVE at the
// moment a line is tagged, then deactivated (a legitimate deactivate-only
// lifecycle action) before Validate is run. Before the P1-F1 fix, Validate
// never evaluated analysis tags at all, so this scenario would have shown
// "pass" at Validate and only failed later at Post. After the fix, Validate
// itself must reject the draft with the same INACTIVE_VALUE rule Post uses.
//
// /api/v1/stores is intercepted because tenant-service (store/entity master
// data) is a separate, out-of-scope bounded context not touched by S011; the
// analysis-tag validation path itself (the system under test) always hits the
// real coa-service — nothing about analysis-code/tag behavior is mocked.
//
// Run with (isolated stack must already be running):
//   BASE_URL=http://localhost:55174/amacc npx playwright test tests/e2e/s011-p1-validate-post-consistency.spec.ts

const BASE = process.env['BASE_URL'] ?? 'http://localhost:55174/amacc';
const API_BASE = process.env['API_BASE'] ?? 'http://localhost:55203';
const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? '';
const TENANT_ID = 'tenant-kunes';
const ENTITY_ID = 'entity-p1';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintDevToken(): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: 'dev-user', tenantId: TENANT_ID, role: 'ADMIN', iat: now, exp: now + 3600 }),
  );
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function seedAuth(page: Page) {
  const token = mintDevToken();
  await page.addInitScript(
    ([t, entity]) => {
      localStorage.setItem('goldenpath.accessToken', t);
      localStorage.setItem('goldenpath.tenantId', 'tenant-kunes');
      localStorage.setItem('goldenpath.legalEntityId', entity as string);
      localStorage.setItem('goldenpath.user', JSON.stringify({ id: 'dev-user', email: 'dev@kunes.test', displayName: 'Dev User', status: 'ACTIVE' }));
    },
    [token, ENTITY_ID],
  );
}

test.describe('S011 P1-F1 — Validate/Post analysis-tag consistency (/golden-path/journal)', () => {
  test.afterEach(async ({ request }) => {
    // Re-activation isn't exposed (deactivate-only lifecycle is intentional),
    // so this test seeds its own fresh analysis-code value per run instead of
    // relying on external cleanup.
  });

  test('an analysis value deactivated after tagging is rejected by Validate, not just Post', async ({ page, request }) => {
    const token = mintDevToken();

    // Seed a fresh, dedicated analysis-code value for this run so repeated
    // runs don't collide with an already-deactivated value from a prior run.
    const suffix = Date.now().toString(36);
    const typeRes = await request.post(`${API_BASE}/api/v1/coa/analysis/types`, {
      headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID },
      data: { code: `P1V${suffix}`.slice(0, 10).toUpperCase(), name: `P1 Verify ${suffix}` },
    });
    expect(typeRes.ok(), `create type: ${typeRes.status()} ${await typeRes.text()}`).toBeTruthy();
    const type = await typeRes.json();

    const valueRes = await request.post(`${API_BASE}/api/v1/coa/analysis/types/${type.id}/values`, {
      headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID },
      data: { code: `V${suffix}`.slice(0, 10).toUpperCase(), name: `Value ${suffix}` },
    });
    expect(valueRes.ok(), `create value: ${valueRes.status()} ${await valueRes.text()}`).toBeTruthy();
    const value = await valueRes.json();

    await seedAuth(page);

    // tenant-service (store master data) is out of scope for S011; supply a
    // fixture store so the real JournalWorkflow form can render its (unrelated)
    // store dropdown without standing up a whole separate microservice.
    await page.route(`**/api/v1/stores?entityId=${ENTITY_ID}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [{ id: 'store-p1', storeCode: '01' }] }) }),
    );

    await page.goto(`${BASE}/golden-path/journal`);

    await expect(page.getByTestId('journal-line-0-account')).toBeVisible({ timeout: 10000 });

    // Wait for the real coa-service accounts + the freshly-created analysis type to load.
    await expect
      .poll(async () => (await page.getByTestId('journal-line-0-account').locator('option').allTextContents()).length, { timeout: 10000 })
      .toBeGreaterThan(1);

    const line0AccountOptions = await page.getByTestId('journal-line-0-account').locator('option').all();
    const line0AccountValue = await line0AccountOptions[1].getAttribute('value'); // index 0 is the "Account…" placeholder
    await page.getByTestId('journal-line-0-account').selectOption(line0AccountValue!);
    await page.getByTestId('journal-line-0-store').selectOption('store-p1');
    await page.getByTestId('journal-line-0-dr').fill('100');

    const line1AccountOptions = await page.getByTestId('journal-line-1-account').locator('option').all();
    const secondAccountValue = (await line1AccountOptions[2]?.getAttribute('value')) ?? (await line1AccountOptions[1]?.getAttribute('value'));
    await page.getByTestId('journal-line-1-account').selectOption(secondAccountValue!);
    await page.getByTestId('journal-line-1-store').selectOption('store-p1');
    await page.getByTestId('journal-line-1-dept').fill('01');
    await page.getByTestId('journal-line-1-cr').fill('100');

    // Tag line 0 with the freshly-created, still-ACTIVE analysis value.
    await expect(page.getByTestId('journal-line-0-tags')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('journal-line-0-tag-type-select').selectOption(type.id);
    await page.getByTestId('journal-line-0-tag-value-select').selectOption(value.id);
    await page.getByTestId('journal-line-0-tag-add').click();
    await expect(page.getByTestId('journal-line-0-tag-chip')).toBeVisible();

    await page.getByTestId('journal-create-draft').click();
    await expect(page.getByTestId('journal-draft-status')).toBeVisible({ timeout: 10000 });

    // Deactivate the value out-of-band (a legitimate registry action), then
    // Validate the SAME draft without touching its tag data — this is exactly
    // the P1-F1 regression scenario.
    const deactivateRes = await request.post(
      `${API_BASE}/api/v1/coa/analysis/types/${type.id}/values/${value.id}/deactivate`,
      {
        headers: { Authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID },
        data: { version: 1, reason: 'P1-F1 verification: simulate value deactivated after tagging' },
      },
    );
    expect(deactivateRes.ok(), `deactivate value: ${deactivateRes.status()} ${await deactivateRes.text()}`).toBeTruthy();

    await page.getByTestId('journal-validate').click();

    await expect(page.getByTestId('journal-validation-result')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('journal-validation-errors')).toBeVisible();
    await expect(page.getByTestId('journal-validation-error').first()).toContainText(/inactive/i);

    await page.screenshot({ path: 'test-results/s011-p1-validate-rejected-inactive-tag.png', fullPage: true });

    // Post must independently reject on the same unchanged data (defense in
    // depth) — this is the "Post is not the only enforcement point" half of
    // the P1-F1 fix.
    const postRes = await page.getByTestId('journal-post');
    if (await postRes.isEnabled()) {
      await postRes.click();
      await expect(page.getByTestId('journal-error')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('journal-error')).toContainText(/validation|inactive/i);
    }
  });
});

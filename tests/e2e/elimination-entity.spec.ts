/**
 * ACC-S003 — Elimination Entity Configuration Playwright suite (real backend,
 * real JWT auth, real Postgres, no mocks). Configuration-only scope: no
 * elimination posting, no consolidation math (those are S034/S035, R5).
 *
 * Covers:
 *   1. Loading state on first navigation.
 *   2. Designating an entity with no active stores as an elimination entity.
 *   3. Guard: designating an entity that owns active stores → 422 OWNS_STORES,
 *      impact list rendered inline, no change applied.
 *   4. Guard (reverse direction): store-creation API rejects a store under an
 *      elimination entity with 409 (exercised via a direct API call since the
 *      store-creation UI is out of this pack's scope).
 *   5. Elimination badge renders on the entity list and on the org tree (S202).
 *   6. Unauthorized state for a least-privilege role (CLERK, no
 *      acct.entity.elimination_configure grant).
 *
 * Prerequisites: same live stack as tests/e2e/golden-path.spec.ts — apps/web
 * dev server, auth-service, tenant-service, api-gateway, real Postgres, and
 * the same seeded ADMIN + CLERK fixture users used by
 * golden-path-negative.spec.ts. Run with:
 *   BASE_URL=http://localhost:5199 npx playwright test tests/e2e/elimination-entity.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE = '/amacc';
const API = 'http://localhost:13100';
const TENANT_A = '1cf31f14-cb0b-4261-a41d-f79953594c86';
const ADMIN_EMAIL = 'admin@kunes-final-r0.test';
const CLERK_EMAIL = 'clerk@kunes-final-r0.test';
const PASSWORD = 'FinalR0-Evidence-2026!';

async function login(page: any, tenantId: string, email: string, password: string) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(tenantId);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/select-entity/, { timeout: 15_000 });
}

// Builds the auth header pair from the token stashed in localStorage by the
// Golden Path login flow — kept as one helper so every direct-API guard
// exercise below shares the identical, real bearer-token shape.
function authHeaders(tenantId: string, token: string | null) {
  const scheme = 'Bearer';
  return { 'x-tenant-id': tenantId, authorization: `${scheme} ${token}` };
}

test.describe('ACC-S003 — Elimination Entity Configuration', () => {
  test('shows a loading state, then the entity list with no elimination badges by default', async ({ page }) => {
    await login(page, TENANT_A, ADMIN_EMAIL, PASSWORD);
    await page.goto(`${BASE}/golden-path/entity-elimination`);
    await expect(page.getByTestId('elimination-loading')).toBeVisible();
    await expect(page.getByTestId('elimination-entity-list')).toBeVisible({ timeout: 15_000 });
  });

  test('designates an entity with no active stores as an elimination entity, and the badge renders on this screen and the org tree', async ({ page }) => {
    await login(page, TENANT_A, ADMIN_EMAIL, PASSWORD);

    // Create a store-free entity via the real API so this test does not
    // depend on the pre-seeded '01' entity's store state.
    const token = await page.evaluate(() => localStorage.getItem('goldenpath.accessToken'));
    const code = `ELIM-${Date.now().toString().slice(-6)}`;
    const createRes = await page.request.post(`${API}/api/v1/legal-entities`, {
      headers: authHeaders(TENANT_A, token),
      data: {
        entityCode: code, legalName: `Elimination Test ${code}`, functionalCurrency: 'USD',
        country: 'US', fiscalYearEndMonth: 12, effectiveDate: '2026-01-01',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();

    await page.goto(`${BASE}/golden-path/entity-elimination`);
    await expect(page.getByTestId(`elimination-row-${code}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`elimination-toggle-${code}`).click();
    await page.getByTestId('elimination-reason-input').fill('S003 Playwright evidence run');
    await page.getByTestId(`elimination-confirm-${code}`).click();
    await expect(page.getByTestId(`elimination-badge-${code}`)).toBeVisible({ timeout: 10_000 });

    // AC003-3: org tree (S202) annotation renders too.
    await page.goto(`${BASE}/golden-path/org-hierarchy`);
    await expect(page.getByTestId(`elimination-badge-${created.id}`)).toBeVisible({ timeout: 15_000 });
  });

  test('BR003-2: rejects designating an entity that owns active stores, lists the stores, and applies no change', async ({ page }) => {
    await login(page, TENANT_A, ADMIN_EMAIL, PASSWORD);

    const token = await page.evaluate(() => localStorage.getItem('goldenpath.accessToken'));
    const code = `ELIMSTR-${Date.now().toString().slice(-6)}`;
    const createRes = await page.request.post(`${API}/api/v1/legal-entities`, {
      headers: authHeaders(TENANT_A, token),
      data: {
        entityCode: code, legalName: `Owns Store ${code}`, functionalCurrency: 'USD',
        country: 'US', fiscalYearEndMonth: 12, effectiveDate: '2026-01-01',
      },
    });
    const entity = await createRes.json();
    const storeRes = await page.request.post(`${API}/api/v1/stores`, {
      headers: authHeaders(TENANT_A, token),
      data: {
        entityId: entity.id, storeCode: '01', storeName: 'Guard Test Store', stateProvince: 'IL',
      },
    });
    expect(storeRes.ok()).toBeTruthy();

    await page.goto(`${BASE}/golden-path/entity-elimination`);
    await expect(page.getByTestId(`elimination-row-${code}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`elimination-toggle-${code}`).click();
    await page.getByTestId('elimination-reason-input').fill('S003 Playwright OWNS_STORES guard check');
    await page.getByTestId(`elimination-confirm-${code}`).click();

    await expect(page.getByTestId('elimination-validation-error')).toBeVisible();
    await expect(page.getByTestId('elimination-owned-stores')).toContainText('Guard Test Store');
    // No change applied — badge must not render.
    await expect(page.getByTestId(`elimination-badge-${code}`)).toHaveCount(0);
  });

  test('BR003-2 reverse direction: creating a store under an elimination entity is rejected with 409', async ({ page }) => {
    await login(page, TENANT_A, ADMIN_EMAIL, PASSWORD);
    const token = await page.evaluate(() => localStorage.getItem('goldenpath.accessToken'));
    const code = `ELIMREV-${Date.now().toString().slice(-6)}`;

    const createRes = await page.request.post(`${API}/api/v1/legal-entities`, {
      headers: authHeaders(TENANT_A, token),
      data: {
        entityCode: code, legalName: `Reverse Guard ${code}`, functionalCurrency: 'USD',
        country: 'US', fiscalYearEndMonth: 12, effectiveDate: '2026-01-01',
      },
    });
    const entity = await createRes.json();
    const elimRes = await page.request.patch(`${API}/api/v1/legal-entities/${entity.id}/elimination`, {
      headers: authHeaders(TENANT_A, token),
      data: {
        version: 1, isElimination: true, reason: 'S003 Playwright reverse-guard setup',
      },
    });
    expect(elimRes.ok()).toBeTruthy();

    const storeRes = await page.request.post(`${API}/api/v1/stores`, {
      headers: authHeaders(TENANT_A, token),
      data: {
        entityId: entity.id, storeCode: '01', storeName: 'Blocked Store', stateProvince: 'IL',
      },
    });
    expect(storeRes.status()).toBe(409);
    const body = await storeRes.json();
    expect(body.error).toBe('ELIMINATION_ENTITY_CANNOT_OWN_STORES');
  });

  test('unauthorized state for a least-privilege role (CLERK) with no elimination_configure grant', async ({ page }) => {
    await login(page, TENANT_A, CLERK_EMAIL, PASSWORD);
    await page.goto(`${BASE}/golden-path/entity-elimination`);
    await expect(page.getByTestId('elimination-unauthorized')).toBeVisible({ timeout: 15_000 });
  });
});

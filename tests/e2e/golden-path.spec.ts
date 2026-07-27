/**
 * FINAL-R0 Golden Path E2E — real backend, real JWT auth, no mocks.
 *
 * Journey: login -> select tenant/legal entity -> fiscal calendar ->
 * accounting period -> Chart of Accounts -> journal draft -> validate ->
 * post -> view -> reverse -> audit history.
 *
 * Prerequisites:
 *   1. `npm run dev` running in apps/web on port 5174 (see vite.config.ts),
 *      proxying /api to the real api-gateway (API_TARGET, default :3100).
 *   2. auth-service, tenant-service, coa-service, api-gateway, audit-service
 *      all running against the real Postgres instance used by this Final-R0
 *      certification pass.
 *   3. A real tenant-scoped user with a known password (seeded for this
 *      certification: tenant 1cf31f14-cb0b-4261-a41d-f79953594c86,
 *      admin@kunes-final-r0.test / GoldenPath!2026), and a second,
 *      cross-tenant user (tenant e410db34-d007-46f9-8e34-aab2009299c9,
 *      xtuser@crosstenant.test / GoldenPath!2026) for the negative scenarios.
 *
 * Run: BASE_URL=http://localhost:5174 npx playwright test tests/e2e/golden-path.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE = '/amacc';
const TENANT_A = '1cf31f14-cb0b-4261-a41d-f79953594c86';
const TENANT_B = 'e410db34-d007-46f9-8e34-aab2009299c9';
const ADMIN_EMAIL = 'admin@kunes-final-r0.test';
const XT_EMAIL = 'xtuser@crosstenant.test';
const PASSWORD = 'GoldenPath!2026';

async function login(page: any, tenantId: string, email: string, password: string) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(tenantId);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

test.describe('FINAL-R0 Golden Path — positive journey', () => {
  test('login -> select entity -> fiscal/period -> COA -> journal -> post -> view -> reverse -> audit', async ({ page }) => {
    // 1. Login (real gateway, real JWT).
    await login(page, TENANT_A, ADMIN_EMAIL, PASSWORD);
    await page.waitForURL(/\/golden-path\/select-entity/, { timeout: 15_000 });

    // 2. Select tenant/legal entity.
    await expect(page.getByTestId('legal-entity-list')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('select-entity-KUNES-01').click();
    await page.waitForURL(/\/golden-path\/fiscal/, { timeout: 10_000 });

    // 3. Fiscal calendar + 4. accounting period.
    await expect(page.getByTestId('fiscal-calendar-status')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('period-board')).toBeVisible();
    // The calendar/periods were already bootstrapped in an earlier certification
    // pass and at least one period is OPEN, so Continue should already be enabled.
    await expect(page.getByTestId('fiscal-continue')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('fiscal-continue').click();
    await page.waitForURL(/\/golden-path\/coa/, { timeout: 10_000 });

    // 5. Chart of Accounts — seed a fresh postable expense account for this run.
    const acctNum = String(60000 + (Date.now() % 900));
    await expect(page.getByTestId('coa-account-table')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('coa-account-number').fill(acctNum);
    await page.getByTestId('coa-account-name').fill('E2E Golden Path Expense');
    await page.getByTestId('coa-account-type').selectOption('EXPENSE');
    await page.getByTestId('coa-create-submit').click();
    await expect(page.getByText(acctNum)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('coa-continue').click();
    await page.waitForURL(/\/golden-path\/journal/, { timeout: 10_000 });

    // 6-9. Journal draft -> validate -> post -> view.
    await expect(page.getByTestId('journal-line-0-account')).toBeVisible({ timeout: 10_000 });
    // Use an entry date inside an already-OPEN period (2026-01..03 were opened
    // during backend certification); "today" in this environment's clock is
    // outside any open period and would correctly fail BR013-2.
    await page.getByTestId('journal-entry-date').fill('2026-01-20');
    await page.getByTestId('journal-line-0-account').selectOption({ label: `${acctNum} E2E Golden Path Expense` });
    await page.getByTestId('journal-line-0-store').selectOption({ index: 1 });
    await page.getByTestId('journal-line-0-dept').fill('20');
    await page.getByTestId('journal-line-0-dr').fill('50');

    await page.getByTestId('journal-line-1-account').selectOption({ label: '10001 Operating Checking' });
    await page.getByTestId('journal-line-1-store').selectOption({ index: 1 });
    await page.getByTestId('journal-line-1-cr').fill('50');

    await page.getByTestId('journal-create-draft').click();
    await expect(page.getByTestId('journal-draft-status')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('journal-validate').click();
    await expect(page.getByTestId('journal-validation-result')).toContainText('true', { timeout: 10_000 });

    await page.getByTestId('journal-post').click();
    await expect(page.getByTestId('journal-view')).toBeVisible({ timeout: 10_000 });

    // 10. Reverse.
    await page.getByTestId('journal-reverse').click();
    await expect(page.getByTestId('journal-reversal-result')).toBeVisible({ timeout: 10_000 });

    // 11. Audit history.
    await page.getByTestId('journal-continue-audit').click();
    await page.waitForURL(/\/golden-path\/audit\//, { timeout: 10_000 });
    await expect(page.getByTestId('audit-event').first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('FINAL-R0 Golden Path — negative scenarios', () => {
  test('unauthorized: unauthenticated visitor is redirected to login', async ({ page }) => {
    await page.goto(`${BASE}/golden-path/select-entity`);
    await page.waitForURL(/\/golden-path\/login/, { timeout: 10_000 });
    await expect(page.getByTestId('login-form')).toBeVisible();
  });

  test('rejects an incorrect password', async ({ page }) => {
    await login(page, TENANT_A, ADMIN_EMAIL, 'wrong-password');
    await expect(page.getByTestId('login-error')).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp('/golden-path/login'));
  });

  test('cross-tenant: tenant B user cannot see tenant A legal entities (denied, not just empty)', async ({ page }) => {
    await login(page, TENANT_B, XT_EMAIL, PASSWORD);
    await page.waitForURL(/\/golden-path\/select-entity/, { timeout: 15_000 });
    // Tenant B user has no role grants at all; centralized S207 authorization
    // must deny access to tenant A's (or any) legal entities outright — this
    // must never silently degrade to an empty list that a caller could
    // misread as "no entities exist".
    await expect(page.getByTestId('select-entity-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('select-entity-error')).toContainText(/forbidden|permission/i);
    await expect(page.getByText('KUNES-01')).toHaveCount(0);
  });
});

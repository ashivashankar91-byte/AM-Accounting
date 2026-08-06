/**
 * S009 — Statement Metadata Administration, focused UI journey.
 *
 * Golden R0 journeys (golden-path.spec.ts, golden-path-negative.spec.ts)
 * are NOT replaced or modified by this spec — this is a separate, additive
 * file per R1 Controlled Integration Step 2C, Phase 6.
 *
 * Covers:
 *   1. Open Statement Metadata (new /accounting/admin/statement-metadata
 *      admin screen, gl-service ownership per S009_DECISION_MEMO.md).
 *   2. View the statement-line catalog (ships empty in v1, BLK-07).
 *   3. Create a statement line.
 *   4. Assign statement metadata to a real GL account (with mandatory
 *      reason, BLK-09) and verify the saved mapping is reflected.
 *   5. Verify effective-range overlap/conflict handling (409
 *      STATEMENT_METADATA_EFFECTIVE_RANGE_OVERLAP).
 *   6. Open the Income Statement and verify Cost of Sales / Gross Profit
 *      render (S009/BLK-08) and the DISTRIBUTION anomaly banner behaves
 *      correctly on the (unaffected) happy path.
 *
 * The DISTRIBUTION_BALANCE_ANOMALY negative scenario itself (direct-SQL
 * scratch fixture proving the fail-closed guard) already lives in
 * golden-path-negative.spec.ts and is intentionally not duplicated here.
 *
 * Prerequisites: same as golden-path.spec.ts (apps/web dev server, real
 * auth-service/tenant-service/gl-service/api-gateway stack, Tenant A admin
 * fixture user). Run with: BASE_URL=http://localhost:5199 npx playwright test
 */
import { test, expect } from '@playwright/test';

const BASE = '/amacc';
const TENANT_A = '1cf31f14-cb0b-4261-a41d-f79953594c86';
const ADMIN_EMAIL = 'admin@kunes-final-r0.test';
const PASSWORD = 'FinalR0-Evidence-2026!';
const GL_ENTITY = '01';
const GL_AS_OF = '2026-02';

async function login(page: any) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(TENANT_A);
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/golden-path\/select-entity/, { timeout: 15_000 });
  await page.getByTestId('select-entity-KUNES-01').click();
  await page.waitForURL(/\/golden-path\/org-hierarchy/, { timeout: 10_000 });
}

test.describe('S009 — Statement Metadata administration (UI)', () => {
  test.setTimeout(60_000);

  test('view catalog, create a statement line, assign account metadata, verify saved state', async ({ page }) => {
    await login(page);

    await page.goto(`${BASE}/accounting/admin/statement-metadata`);
    await expect(page.getByTestId('statement-metadata-page')).toBeVisible({ timeout: 10_000 });

    // Statement-line catalog: create one (BLK-07 — ships empty in v1).
    const code = `E2E${Date.now().toString().slice(-6)}`;
    await page.getByTestId('sm-new-line').click();
    await page.getByTestId('statement-line-code-input').fill(code);
    await page.getByTestId('statement-line-name-input').fill('E2E Test Section');
    await page.getByTestId('statement-line-statement-select').selectOption('IS');
    await page.getByTestId('statement-line-section-input').fill('E2E_SECTION');
    await page.getByTestId('statement-line-submit').click();
    await expect(page.getByTestId(`statement-line-row-${code}`)).toBeVisible({ timeout: 10_000 });

    // Assign the new line to the first available GL account.
    const firstAssignBtn = page.locator('[data-testid^="account-mapping-assign-"]').first();
    await expect(firstAssignBtn).toBeVisible({ timeout: 10_000 });
    const rowTestId = await firstAssignBtn.evaluate((el: HTMLElement) => el.getAttribute('data-testid'));
    const accountCode = rowTestId!.replace('account-mapping-assign-', '');

    await firstAssignBtn.click();
    await expect(page.getByTestId('account-metadata-form')).toBeVisible();
    await page.getByTestId('account-metadata-line-select').selectOption({ label: new RegExp(code) });
    const effectiveFrom = new Date().toISOString().slice(0, 10);
    await page.getByTestId('account-metadata-effective-from-input').fill(effectiveFrom);
    await page.getByTestId('account-metadata-reason-input').fill('E2E journey — initial mapping assignment');
    await page.getByTestId('account-metadata-submit').click();

    await expect(page.getByTestId('statement-metadata-success')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`account-mapping-current-${accountCode}`)).toContainText('E2E Test Section');

    // Overlap/conflict handling: re-assigning the SAME account with an
    // effectiveFrom on/before the just-created (still-open) range must be
    // rejected with the real 409 STATEMENT_METADATA_EFFECTIVE_RANGE_OVERLAP,
    // not silently accepted or misreported as a generic error.
    await page.getByTestId(`account-mapping-assign-${accountCode}`).click();
    await page.getByTestId('account-metadata-line-select').selectOption({ label: new RegExp(code) });
    await page.getByTestId('account-metadata-effective-from-input').fill(effectiveFrom);
    await page.getByTestId('account-metadata-reason-input').fill('E2E journey — overlap conflict proof');
    await page.getByTestId('account-metadata-submit').click();
    await expect(page.getByTestId('account-metadata-overlap-conflict')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('account-metadata-form').locator('button', { hasText: 'Cancel' }).click();

    // Income Statement: Cost of Sales / Gross Profit render, and the
    // DISTRIBUTION anomaly banner is correctly ABSENT on this unaffected
    // happy path (the anomaly itself is proven separately, see
    // golden-path-negative.spec.ts).
    await page.goto(`${BASE}/golden-path/income-statement`);
    await page.getByTestId('is-entity').fill(GL_ENTITY);
    await page.getByTestId('is-asof').fill(GL_AS_OF);
    await page.getByTestId('is-run').click();
    await expect(page.getByTestId('is-cost-of-sales-table')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('is-gross-profit')).toBeVisible();
    await expect(page.getByTestId('is-distribution-anomaly-banner')).toHaveCount(0);
  });
});

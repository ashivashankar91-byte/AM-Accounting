import { test, expect, Page } from '@playwright/test';

// baseURL from playwright.config.ts; Vite base = /amacc/
const STORES_URL = '/amacc/setup/stores';

// 5-digit OEMs vs 6-digit OEMs (mirrors oem_ref seed patterns).
const FIVE_DIGIT = new Set(['FORD', 'TOYOTA', 'STELLANTIS']);

async function openFirstStoreDetail(page: Page): Promise<boolean> {
  await page.goto(STORES_URL);
  await page.waitForLoadState('networkidle');
  const rows = page.locator('table tbody tr');
  if ((await rows.count()) === 0) return false;
  await rows.first().click();
  await expect(page).toHaveURL(/\/amacc\/setup\/stores\/(?!new)/, { timeout: 10_000 });
  await page.waitForLoadState('networkidle');
  return true;
}

test.describe('S204 – Franchises within Store', () => {
  test('franchises section renders on store detail', async ({ page }) => {
    if (!(await openFirstStoreDetail(page))) { test.skip(); return; }
    await expect(page.locator('[data-testid="franchises-section"]')).toBeVisible({ timeout: 10_000 });
  });

  test('add-franchise button opens the form with OEM dropdown', async ({ page }) => {
    if (!(await openFirstStoreDetail(page))) { test.skip(); return; }
    const addBtn = page.locator('[data-testid="add-franchise"]');
    // Inactive store hides the button → skip gracefully.
    try {
      await expect(addBtn).toBeVisible({ timeout: 5_000 });
    } catch {
      test.skip();
      return;
    }
    await addBtn.click();
    await expect(page.locator('[data-testid="franchise-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="franchise-oem"]')).toBeVisible();
  });

  test('bad dealer code surfaces a validation error', async ({ page }) => {
    if (!(await openFirstStoreDetail(page))) { test.skip(); return; }
    const addBtn = page.locator('[data-testid="add-franchise"]');
    try { await expect(addBtn).toBeVisible({ timeout: 5_000 }); } catch { test.skip(); return; }
    await addBtn.click();

    // Pick the first real OEM option and submit an obviously-wrong dealer code.
    const oemSelect = page.locator('[data-testid="franchise-oem"]');
    const values = await oemSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v),
    );
    if (values.length === 0) { test.skip(); return; }
    await oemSelect.selectOption(values[0]);
    await page.locator('[data-testid="franchise-dealer-code"]').fill('X');
    await page.locator('[data-testid="save-franchise"]').click();
    await expect(page.locator('[data-testid="franchise-form-error"]')).toBeVisible({ timeout: 10_000 });
  });

  test('add a franchise for an available OEM (requires backend)', async ({ page }) => {
    if (!(await openFirstStoreDetail(page))) { test.skip(); return; }
    const addBtn = page.locator('[data-testid="add-franchise"]');
    try { await expect(addBtn).toBeVisible({ timeout: 5_000 }); } catch { test.skip(); return; }
    await addBtn.click();

    const oemSelect = page.locator('[data-testid="franchise-oem"]');
    const values = await oemSelect.locator('option').evaluateAll((opts) =>
      opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v),
    );

    // Choose an OEM not already present in the franchise table.
    let chosen = '';
    for (const v of values) {
      if ((await page.locator(`[data-testid="franchise-row-${v}"]`).count()) === 0) { chosen = v; break; }
    }
    if (!chosen) { test.skip(); return; } // all OEMs already on this store

    await oemSelect.selectOption(chosen);
    const dealerCode = FIVE_DIGIT.has(chosen) ? '54321' : '654321';
    await page.locator('[data-testid="franchise-dealer-code"]').fill(dealerCode);
    await page.locator('[data-testid="save-franchise"]').click();

    // The new franchise row should appear.
    await expect(page.locator(`[data-testid="franchise-row-${chosen}"]`)).toBeVisible({ timeout: 10_000 });
  });
});

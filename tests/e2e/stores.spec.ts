import { test, expect, Page } from '@playwright/test';

// baseURL = http://localhost:5173 (from playwright.config.ts)
// Vite base = /amacc/  → full path = http://localhost:5173/amacc/setup/stores

const STORES_URL   = '/amacc/setup/stores';
const STORES_NEW   = '/amacc/setup/stores/new';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fillStoreForm(
  page: Page,
  opts: {
    entitySelectIndex?: number; // pick nth option (0 = select…, 1 = first entity)
    storeCode: string;
    storeName: string;
    stateProvince: string;
    city?: string;
    postalCode?: string;
  },
) {
  if (opts.entitySelectIndex !== undefined) {
    await page.locator('[data-testid="entity-select"]').selectOption({ index: opts.entitySelectIndex });
  }
  await page.locator('[data-testid="store-code"]').fill(opts.storeCode);
  await page.locator('[data-testid="store-name"]').fill(opts.storeName);
  await page.locator('[data-testid="state-province"]').selectOption(opts.stateProvince);
  if (opts.city)       await page.locator('[data-testid="city"]').fill(opts.city);
  if (opts.postalCode) await page.locator('[data-testid="postal-code"]').fill(opts.postalCode);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('S201 – Stores CRUD', () => {
  test('store list page loads with table or empty state', async ({ page }) => {
    await page.goto(STORES_URL);
    await page.waitForLoadState('networkidle');

    // Either the table or the empty state should be visible
    const tableOrEmpty = page.locator('table, [data-testid="create-store-empty-state"], [data-testid="create-store-header"]');
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  test('search filter input is present and accepts text', async ({ page }) => {
    await page.goto(STORES_URL);
    await page.waitForLoadState('networkidle');

    const searchBox = page.locator('[data-testid="store-search"]');
    await expect(searchBox).toBeVisible();
    await searchBox.fill('north');
    await expect(searchBox).toHaveValue('north');
  });

  test('status filter pills are present', async ({ page }) => {
    await page.goto(STORES_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="filter-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-active"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-inactive"]')).toBeVisible();
  });

  test('navigate to Add Store form and validate required fields', async ({ page }) => {
    await page.goto(STORES_URL);
    await page.waitForLoadState('networkidle');

    // Click Add Store button (header or empty-state)
    const addBtn = page.locator('[data-testid="create-store-header"], [data-testid="create-store-empty-state"]');
    await addBtn.first().click();

    await expect(page).toHaveURL(new RegExp(STORES_NEW));

    // Try to save with empty form → validation errors
    await page.locator('[data-testid="save-store"]').click();
    // At minimum the first required field error should appear
    await expect(page.locator('p.text-red-500, .text-red-500').first()).toBeVisible({ timeout: 5_000 });
  });

  test('create a store (requires backend)', async ({ page }) => {
    await page.goto(STORES_NEW);
    await page.waitForLoadState('networkidle');

    const timestamp = Date.now();

    // Select first legal entity if dropdown has options beyond the placeholder
    const entitySelect = page.locator('[data-testid="entity-select"]');
    const optionCount = await entitySelect.locator('option').count();
    if (optionCount > 1) {
      await entitySelect.selectOption({ index: 1 });
    } else {
      // Skip test gracefully if no entities available
      test.skip();
      return;
    }

    await fillStoreForm(page, {
      storeCode:    `T${String(timestamp).slice(-4)}`,
      storeName:    `Test Store ${timestamp}`,
      stateProvince: 'IL',
      city:          'Chicago',
      postalCode:    '60601',
    });

    await page.locator('[data-testid="save-store"]').click();

    // On success, redirected to /amacc/setup/stores/:id
    await expect(page).toHaveURL(/\/amacc\/setup\/stores\/(?!new)/, { timeout: 10_000 });

    // The store code badge should be visible in the detail view
    await expect(page.locator('span.font-mono').first()).toBeVisible();
  });

  test('view store detail page (requires existing store)', async ({ page }) => {
    await page.goto(STORES_URL);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await rows.first().click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/amacc\/setup\/stores\/(?!new)/);

    // Back link should be present
    await expect(page.getByText('Back to Stores')).toBeVisible();
  });

  test('edit store name (requires existing store)', async ({ page }) => {
    await page.goto(STORES_URL);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await rows.first().click();
    await page.waitForLoadState('networkidle');

    // Click Edit
    await page.locator('[data-testid="edit-store"]').click();

    // storeName field should be editable
    const nameInput = page.locator('[data-testid="store-name"]');
    await expect(nameInput).toBeVisible();

    const originalName = await nameInput.inputValue();
    const newName = `${originalName} (edited)`;
    await nameInput.fill(newName);

    await page.locator('[data-testid="save-store"]').click();

    // Should return to view mode — edit button visible again
    await expect(page.locator('[data-testid="edit-store"]')).toBeVisible({ timeout: 10_000 });
  });

  test('deactivate store shows confirmation modal (requires active store)', async ({ page }) => {
    await page.goto(STORES_URL);
    await page.waitForLoadState('networkidle');

    // Prefer filtering to active stores
    await page.locator('[data-testid="filter-active"]').click();
    // Wait for the table to settle (React re-fetches after filter change)
    await page.waitForTimeout(600);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    if (count === 0) {
      test.skip();
      return;
    }

    await rows.first().click();
    await page.waitForLoadState('networkidle');

    // Deactivate button should be visible for active store
    const deactivateBtn = page.locator('[data-testid="deactivate-store"]');
    await expect(deactivateBtn).toBeVisible();
    await deactivateBtn.click();

    // Modal should appear
    await expect(page.locator('[data-testid="deactivate-modal"]')).toBeVisible();

    // Confirm button should be disabled or submittable only with reason
    const confirmBtn = page.locator('[data-testid="confirm-deactivate"]');
    await expect(confirmBtn).toBeVisible();

    // Try to submit without a reason
    await confirmBtn.click();
    await expect(page.locator('p.text-red-500').first()).toBeVisible();

    // Fill reason and submit
    await page.locator('[data-testid="deactivate-reason"]').fill('Closing this location');
    await confirmBtn.click();

    // Modal should close; store status should now be INACTIVE
    await expect(page.locator('[data-testid="deactivate-modal"]')).not.toBeVisible({ timeout: 10_000 });
  });
});

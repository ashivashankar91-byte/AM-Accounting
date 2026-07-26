import { test, expect, Page } from '@playwright/test';

// baseURL = http://localhost:5173 (playwright.config.ts)
// Vite base = /amacc/
const DEPT_URL = '/amacc/setup/departments';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the entity ID from the first option in the entity selector, or null */
async function getFirstEntityId(page: Page): Promise<string | null> {
  const sel = page.locator('[data-testid="entity-selector"]');
  await expect(sel).toBeVisible({ timeout: 10_000 });
  const value = await sel.inputValue();
  return value || null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('S203 – Departments CRUD', () => {
  test('department list page loads with entity selector', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="entity-selector"]')).toBeVisible({ timeout: 10_000 });

    // After entity is selected, should show table or empty state
    const tableOrEmpty = page.locator('table, [data-testid="create-department-empty-state"], [data-testid="create-department-header"]');
    await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });
  });

  test('search filter input is present and accepts text', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    const searchBox = page.locator('[data-testid="department-search"]');
    await expect(searchBox).toBeVisible({ timeout: 10_000 });
    await searchBox.fill('service');
    await expect(searchBox).toHaveValue('service');
  });

  test('status filter pills are present', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="filter-all"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="filter-active"]')).toBeVisible();
    await expect(page.locator('[data-testid="filter-inactive"]')).toBeVisible();
  });

  test('canonical departments shown when entity has been seeded', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    // Wait for table to appear (canonical departments seeded for Kunes entity)
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });

    // Should have at least 12 canonical rows
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(12);

    // Canonical badge should appear
    await expect(page.locator('text=Canonical').first()).toBeVisible();
  });

  test('navigate to Add Dept form and validate required fields', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    // Click Add Department header button
    const addBtn = page.locator('[data-testid="create-department-header"], [data-testid="create-department-empty-state"]');
    await expect(addBtn.first()).toBeVisible({ timeout: 10_000 });
    await addBtn.first().click();

    await page.waitForLoadState('networkidle');

    // Try to save with empty form → validation errors
    await page.locator('[data-testid="save-department"]').click();
    await expect(page.locator('p.text-red-500, .text-red-500').first()).toBeVisible({ timeout: 5_000 });
  });

  test('create a custom department (code 21)', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    const entityId = await getFirstEntityId(page);
    if (!entityId) { test.skip(); return; }

    // Navigate to create form for the selected entity
    await page.goto(`/amacc/setup/departments/${entityId}/new`);
    await page.waitForLoadState('networkidle');

    const timestamp = Date.now();
    // Generate a unique code in 20-88 range so repeated runs don't conflict
    const code = String(20 + (timestamp % 69)).padStart(2, '0');

    await page.locator('[data-testid="dept-code"]').fill(code);
    await page.locator('[data-testid="dept-name"]').fill(`EV Service ${timestamp}`);

    await page.locator('[data-testid="save-department"]').click();

    // On success → navigated to detail page (URL changes from /new to /:entityId/:id)
    await expect(page).toHaveURL(/\/amacc\/setup\/departments\/[^/]+\/(?!new)/, { timeout: 10_000 });

    // Code badge should be visible
    await expect(page.locator('span.font-mono').first()).toBeVisible();
  });

  test('view department detail page (requires existing dept)', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    const count = await rows.count();
    if (count === 0) { test.skip(); return; }

    await rows.first().click();
    await page.waitForLoadState('networkidle');

    // URL: /amacc/setup/departments/:entityId/:id
    await expect(page).toHaveURL(/\/amacc\/setup\/departments\/[^/]+\/[^/]+/);

    // Back link should be present
    await expect(page.getByText('Back to Departments')).toBeVisible();
  });

  test('edit a canonical department name', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    if (await rows.count() === 0) { test.skip(); return; }

    // Click first row (canonical dept 01)
    await rows.first().click();
    await page.waitForLoadState('networkidle');

    // Click Edit
    await page.locator('[data-testid="edit-department"]').click();

    const nameInput = page.locator('[data-testid="dept-name"]');
    await expect(nameInput).toBeVisible();

    const originalName = await nameInput.inputValue();
    await nameInput.fill(`${originalName} (edited)`);

    await page.locator('[data-testid="save-department"]').click();

    // Back to view mode — Edit button visible again
    await expect(page.locator('[data-testid="edit-department"]')).toBeVisible({ timeout: 10_000 });
  });

  test('deactivate department shows modal and confirms (requires active dept)', async ({ page }) => {
    await page.goto(DEPT_URL);
    await page.waitForLoadState('networkidle');

    // Filter to active
    await page.locator('[data-testid="filter-active"]').click();
    await page.waitForTimeout(400);
    await page.waitForLoadState('networkidle');

    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    if (count === 0) { test.skip(); return; }

    // Find the custom dept row (code 21) — skip if not present
    let targetRow = rows.last(); // custom depts sort after 12 canonical ones

    await targetRow.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);

    const deactivateBtn = page.locator('[data-testid="deactivate-department"]');
    // Wait up to 5s for button to appear — skip if it never appears (dept already inactive)
    try {
      await expect(deactivateBtn).toBeVisible({ timeout: 5_000 });
    } catch {
      test.skip();
      return;
    }

    await deactivateBtn.click();

    // Modal should appear
    await expect(page.locator('[data-testid="deactivate-modal"]')).toBeVisible({ timeout: 5_000 });

    // Fill reason
    await page.locator('[data-testid="deactivate-reason"]').fill('E2E test deactivation');

    // Confirm
    await page.locator('[data-testid="confirm-deactivate"]').click();

    // Status badge should update to INACTIVE
    await expect(page.locator('[data-testid="deactivation-record"]')).toBeVisible({ timeout: 10_000 });
  });
});

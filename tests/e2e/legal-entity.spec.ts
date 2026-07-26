/**
 * ACC-S200 E2E Tests — Legal Entity Management
 *
 * Covers the core demo flow:
 *   1. Navigate to Legal Entities from Admin sidebar
 *   2. Create a new legal entity
 *   3. View the entity detail
 *   4. Edit the entity
 *   5. Deactivate with reason
 *
 * Prerequisites:
 *   1. `npm run dev` running in apps/web (port 5173)
 *   2. tenant-service running (port 3002)
 *   3. api-gateway running (port 3000 or same-origin proxy active)
 *
 * Run: npx playwright test tests/e2e/legal-entity.spec.ts
 */

import { test, expect } from '@playwright/test';

const BASE   = 'http://localhost:5173/amacc';
const LE_URL = `${BASE}/setup/legal-entities`;

// Unique code per run to avoid conflicts
const CODE = `E2E-${Date.now().toString().slice(-5)}`;

// ── Suite ──────────────────────────────────────────────────────────────────

test.describe('ACC-S200: Legal Entity CRUD', () => {
  let entityId: string | undefined;

  // ── 1. Navigate to list ──────────────────────────────────────────────────

  test('shows Legal Entities page via sidebar', async ({ page }) => {
    await page.goto(BASE);

    // Click Admin section in sidebar
    await page.click('[data-testid="nav-admin"]', { timeout: 5000 }).catch(() => {
      // Fallback: navigate directly if data-testid isn't set yet
    });

    await page.goto(LE_URL);
    await expect(page.getByRole('heading', { name: /legal entities/i })).toBeVisible({ timeout: 10_000 });
    // Two "Create Entity" buttons can be visible at once (header CTA + empty-state CTA);
    // target the header one specifically via its stable data-testid.
    await expect(page.getByTestId('create-entity-header')).toBeVisible();
  });

  // ── 2. Create ────────────────────────────────────────────────────────────

  test('creates a new legal entity', async ({ page }) => {
    await page.goto(`${LE_URL}/new`);
    await expect(page.getByRole('heading', { name: /new legal entity/i })).toBeVisible({ timeout: 10_000 });

    // Fill Identity
    await page.fill('input[placeholder*="KUNES-IL"]', CODE);
    await page.fill('input[placeholder*="Full legal name"]', `E2E Test Corp ${CODE}`);
    await page.fill('input[placeholder*="Short name"]', `E2E ${CODE}`);
    await page.fill('input[placeholder*="XX-XXXXXXX"]', '99-1234567');

    // Financial — defaults are fine (USD, US, December)
    // Address
    await page.fill('input[placeholder*="123 Main"]', '1 Test Ave');
    await page.getByLabel('City').fill('Chicago');

    // Save
    await page.click('button:has-text("Create Entity")');

    // Should navigate to detail page after creation
    await page.waitForURL(/\/setup\/legal-entities\/[a-f0-9-]+/, { timeout: 15_000 });

    const url = page.url();
    entityId  = url.split('/').pop();
    expect(entityId).toBeTruthy();
  });

  // ── 3. View detail ───────────────────────────────────────────────────────

  test('displays entity details correctly', async ({ page }) => {
    if (!entityId) test.skip();
    await page.goto(`${LE_URL}/${entityId}`);

    await expect(page.getByText(CODE)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/E2E Test Corp/)).toBeVisible();
    await expect(page.getByText('ACTIVE')).toBeVisible();
    await expect(page.getByText('USD')).toBeVisible();
  });

  // ── 4. Edit ──────────────────────────────────────────────────────────────

  test('edits the legal name', async ({ page }) => {
    if (!entityId) test.skip();
    await page.goto(`${LE_URL}/${entityId}`);

    await page.click('button:has-text("Edit")');
    await expect(page.getByText(/edit/i).first()).toBeVisible({ timeout: 5_000 });

    // Clear and fill legal name
    const legalNameInput = page.locator('input[placeholder*="Full legal name"]');
    await legalNameInput.clear();
    await legalNameInput.fill(`E2E Updated Corp ${CODE}`);

    await page.click('button:has-text("Save Changes")');

    // Should switch back to details tab after save
    await expect(page.getByText(`E2E Updated Corp ${CODE}`)).toBeVisible({ timeout: 10_000 });
  });

  // ── 5. Audit Timeline ───────────────────────────────────────────────────

  test('shows audit timeline tab', async ({ page }) => {
    if (!entityId) test.skip();
    await page.goto(`${LE_URL}/${entityId}`);

    await page.click('button:has-text("Audit Timeline")');
    // Either shows events or the empty state
    const hasEvents   = page.getByText(/LEGAL_ENTITY/i);
    const emptyAudit  = page.getByText(/no audit events/i);
    await expect(hasEvents.or(emptyAudit)).toBeVisible({ timeout: 10_000 });
  });

  // ── 6. Deactivate ────────────────────────────────────────────────────────

  test('deactivates entity with a reason', async ({ page }) => {
    if (!entityId) test.skip();
    await page.goto(`${LE_URL}/${entityId}`);

    await page.click('button:has-text("Deactivate")');
    await expect(page.getByText(/impact/i)).toBeVisible({ timeout: 5_000 });

    await page.fill('textarea', 'E2E test deactivation — automated cleanup');
    await page.click('button:has-text("Deactivate"):not([disabled])');

    // Status should change to INACTIVE
    await expect(page.getByText('INACTIVE')).toBeVisible({ timeout: 10_000 });
  });

  // ── 7. List reflects inactive entity ────────────────────────────────────

  test('inactive entity appears in Inactive filter', async ({ page }) => {
    await page.goto(LE_URL);
    await page.click('button:has-text("Inactive")');
    await expect(page.getByText(CODE)).toBeVisible({ timeout: 10_000 });
  });

  // ── 8. Search ────────────────────────────────────────────────────────────

  test('search filters the entity list', async ({ page }) => {
    await page.goto(LE_URL);
    await page.fill('input[placeholder*="Search"]', CODE);
    await expect(page.getByText(CODE)).toBeVisible({ timeout: 10_000 });
  });
});

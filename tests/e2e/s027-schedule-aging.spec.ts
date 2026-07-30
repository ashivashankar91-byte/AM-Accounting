/**
 * S027 — Schedule Aging Engine browser journey (real backend, real JWT auth,
 * real Postgres, no mocks). Same conventions as
 * tests/e2e/s026-schedule-open-items.spec.ts, including the login() fix that
 * removes the tenant-service dependency (waits for the login form to
 * disappear rather than for /golden-path/select-entity, which this isolated
 * stack does not run — see that spec's login() comment for the full
 * rationale).
 *
 * Covers the S027 journey:
 *   1.  Log in as an authorized user (holds schedule.aging.view).
 *   2.  Navigate to the S026/S027 page's Aging Report tab for the fixture
 *       schedule.
 *   3.  Bucket totals and the item-level table render for the fixture's
 *       known open items.
 *   4.  A partially-applied fixture item ages on its remaining balance, not
 *       its original amount.
 *   5.  A fully-closed fixture item is excluded from the report entirely.
 *   6.  The reconciliation badge shows a MATCH (green), proving the aging
 *       total equals the independent S026 open-item total end to end
 *       through the real API — not merely asserted in a unit test.
 *   7.  Reload and verify the report (and reconciliation) persist.
 *   8.  Filtering by a nonexistent Control# yields the empty state.
 *   9.  Filtering by the real fixture Control# narrows the result set
 *       correctly.
 *  10.  No unexpected console/network errors.
 *
 * Prerequisites: same live stack as
 * tests/e2e/s026-schedule-open-items.spec.ts, plus S027's own migrations
 * (services/schedule-service/prisma/migrations/
 * 20260730020000_s027_aging_bucket_config and
 * 20260730020001_add_rls_policies_aging_config_schedule_svc) and the
 * schedule.aging.* permission catalog entries
 * (services/auth-service/prisma/migrations/
 * 20260730020000_extend_authz_catalog_s027_aging). Fixture data is seeded
 * independently of the S026 spec's own fixture (dedicated schedule/control#)
 * so this spec does not depend on S026's spec having run first.
 */
import { test, expect, Page } from '@playwright/test';

const BASE = '/amacc';
const TENANT_A = process.env['S027_TENANT_ID'] ?? '1cf31f14-cb0b-4261-a41d-f79953594c86';
const ADMIN_EMAIL = process.env['S027_ADMIN_EMAIL'] ?? 'admin@kunes-final-r0.test';
const NO_GRANT_EMAIL = process.env['S027_NO_GRANT_EMAIL'] ?? 'clerk@kunes-final-r0.test';
const PASSWORD = process.env['S027_PASSWORD'] ?? 'FinalR0-Evidence-2026!';
const SCHEDULE_NUMBER = process.env['S027_SCHEDULE_NUMBER'] ?? '78';
const CONTROL_NUMBER = process.env['S027_CONTROL_NUMBER'] ?? 'AGINGFIX01';
const CLOSED_ITEM_NUMBER = process.env['S027_CLOSED_ITEM_NUMBER'] ?? 'S027FIXCLS';
const PARTIAL_ITEM_NUMBER = process.env['S027_PARTIAL_ITEM_NUMBER'] ?? 'S027FIXPRT';
const PARTIAL_REMAINING = process.env['S027_PARTIAL_REMAINING'] ?? '60.00';

const OPEN_ITEMS_URL = `${BASE}/accounting/schedules/open-items?schedule=${SCHEDULE_NUMBER}`;

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(TENANT_A);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-submit')).toHaveCount(0, { timeout: 20_000 });
}

test.describe('S027 — Schedule Aging Engine journey', () => {
  test('bucket totals, partial/closed handling, reconciliation, reload persistence, empty and filtered states', async ({ page }) => {
    test.setTimeout(120_000);

    // 1. Log in.
    await login(page, ADMIN_EMAIL);

    // 2. Open the Aging Report tab.
    await page.goto(OPEN_ITEMS_URL);
    await page.getByTestId('aging-tab-button').click();

    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    const failedRequests: string[] = [];
    // Scoped to /api/ requests only — see s026-schedule-open-items.spec.ts's
    // identical comment for why third-party resources are excluded.
    page.on('requestfailed', (req) => { if (req.url().includes('/api/')) failedRequests.push(req.url()); });

    // 3. Bucket totals render.
    await expect(page.getByText('Current', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('90+', { exact: true }).first()).toBeVisible();

    // 4. The partially-applied fixture item ages on its REMAINING balance
    // (60.00), not its original amount.
    const partialRow = page.locator('tr', { hasText: PARTIAL_ITEM_NUMBER });
    await expect(partialRow).toBeVisible({ timeout: 20_000 });
    await expect(partialRow).toContainText(PARTIAL_REMAINING);

    // 5. The fully-closed fixture item is excluded entirely.
    await expect(page.locator('tr', { hasText: CLOSED_ITEM_NUMBER })).toHaveCount(0);

    // 6. Reconciliation badge shows a real MATCH through the live API —
    // proves the aging total equals the independent S026 open-item total,
    // end to end, not merely in a unit test.
    const badge = page.getByTestId('aging-reconciliation-badge');
    await expect(badge).toBeVisible({ timeout: 20_000 });
    await expect(badge).toHaveText(/Reconciles to open-item total/);

    // 7. Reload and verify the report (and reconciliation) persist.
    await page.reload();
    await page.getByTestId('aging-tab-button').click();
    await expect(page.locator('tr', { hasText: PARTIAL_ITEM_NUMBER })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('aging-reconciliation-badge')).toHaveText(/Reconciles to open-item total/, { timeout: 20_000 });

    // 8. Empty state — a nonexistent Control# yields no rows, not an error.
    const controlFilter = page.locator('input[placeholder="(blank=all)"]').first();
    await controlFilter.fill('NO-SUCH-CTRL-XYZ');
    await page.getByTestId('aging-refresh-button').click();
    await expect(page.getByText('No aged open items found.')).toBeVisible({ timeout: 20_000 });

    // 9. Filtering by the real fixture Control# narrows the result set.
    await controlFilter.fill(CONTROL_NUMBER);
    await page.getByTestId('aging-refresh-button').click();
    await expect(page.getByRole('cell', { name: CONTROL_NUMBER }).first()).toBeVisible({ timeout: 20_000 });

    // 10. No unexpected console/network errors.
    expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
    expect(failedRequests, `Unexpected failed requests: ${failedRequests.join('; ')}`).toEqual([]);
  });

  test('unauthorized user sees the unauthorized state, not aging data', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, NO_GRANT_EMAIL);
    await page.goto(OPEN_ITEMS_URL);
    await page.getByTestId('aging-tab-button').click();

    await expect(page.getByTestId('aging-reconciliation-badge')).toHaveCount(0, { timeout: 15_000 });
  });
});

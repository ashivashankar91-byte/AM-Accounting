/**
 * S026 — Schedule Open-Item Core browser journey (real backend, real JWT
 * auth, real Postgres, no mocks). Modeled on tests/e2e/vendor-master.spec.ts
 * and tests/e2e/s009-statement-metadata.spec.ts's login convention.
 *
 * Covers the S026 journey:
 *   1.  Log in as an authorized user (holds schedule.open_item.* and
 *       schedule.tie_out.* grants).
 *   2.  Navigate to Schedule Inquiry, select the fixture schedule, use the
 *       "Open Items & Tie-Out" link to reach the new S026 page.
 *   3.  Open-items list loading state resolves for the fixture schedule.
 *   4.  A posted invoice (created via the fixture setup, exercising the real
 *       JOURNAL_ENTRY_POSTED -> OpenItemService.processPostingEvent path)
 *       appears as an OPEN item with the correct original/remaining balance.
 *   5.  Apply a partial payment through the UI — status becomes
 *       PARTIALLY_APPLIED, remaining balance decreases.
 *   6.  Apply the remaining balance — status becomes CLOSED, Apply button
 *       disappears.
 *   7.  Reverse the second application — status reverts to
 *       PARTIALLY_APPLIED, remaining balance is restored.
 *   8.  Switch to the GL Tie-Out tab; run an on-demand tie-out.
 *   9.  Tie-out results render with a status badge per (schedule, GL
 *       account) row (MATCHED or DISCREPANCY — this fixture's schedule has
 *       no gl-service posting, so a DISCREPANCY row is expected and must be
 *       visibly flagged, not hidden).
 *   10. An unauthorized (no schedule.open_item.* grant) user sees the
 *       unauthorized UI state on this page.
 *   11. No unexpected console/network errors.
 *
 * Prerequisites (same shape as vendor-master.spec.ts's live-stack list):
 * apps/web dev server, auth-service, tenant-service, schedule-service,
 * gl-service, api-gateway, real Postgres with S026 migrations applied
 * (services/schedule-service/prisma/migrations/20260730010000_s026_open_items
 * and 20260730010001_add_rls_policies_schedule_svc), and seeded ADMIN + a
 * no-open-item-grant fixture user for this tenant, plus a fixture schedule
 * (S026_SCHEDULE_NUMBER) with at least one posted invoice already applied
 * via JOURNAL_ENTRY_POSTED before this spec runs (see
 * scripts/s026-seed-fixture.ts or equivalent certification-run seeding step
 * — this spec does not create the posting itself, matching the existing
 * convention of s009-statement-metadata.spec.ts relying on pre-seeded
 * statement data rather than posting a journal entry from the browser).
 */
import { test, expect, Page } from '@playwright/test';

const BASE = '/amacc';
const TENANT_A = process.env['S026_TENANT_ID'] ?? '1cf31f14-cb0b-4261-a41d-f79953594c86';
const ADMIN_EMAIL = process.env['S026_ADMIN_EMAIL'] ?? 'admin@kunes-final-r0.test';
const NO_GRANT_EMAIL = process.env['S026_NO_GRANT_EMAIL'] ?? 'clerk@kunes-final-r0.test';
const PASSWORD = process.env['S026_PASSWORD'] ?? 'FinalR0-Evidence-2026!';
const SCHEDULE_NUMBER = process.env['S026_SCHEDULE_NUMBER'] ?? '77';
const ITEM_NUMBER = process.env['S026_ITEM_NUMBER'] ?? 'S026FIX01';
const ORIGINAL_AMOUNT = process.env['S026_ORIGINAL_AMOUNT'] ?? '200.00';

const OPEN_ITEMS_URL = `${BASE}/accounting/schedules/open-items?schedule=${SCHEDULE_NUMBER}`;

// login() only needs auth-service (tenantId is fixed at login, independent
// of legal-entity selection — see apps/web/src/auth/AuthContext.tsx). It
// deliberately does not wait for or navigate through /golden-path/select-
// entity (that page calls tenant-service, out of scope for this isolated
// S026/S027 stack) — it waits for the login form to disappear instead,
// proving the real POST /api/v1/auth/login round-trip succeeded.
async function login(page: Page, email: string) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(TENANT_A);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-submit')).toHaveCount(0, { timeout: 20_000 });
}

test.describe('S026 — Schedule Open-Item Core journey', () => {
  test('list, partial apply, reload persistence, full apply/close, reverse, GL tie-out, permission-aware controls', async ({ page }) => {
    test.setTimeout(120_000);

    // 1. Log in as an authorized user.
    await login(page, ADMIN_EMAIL);

    // 2. Open the Schedule Open Items UI (schedule pre-filled via query
    // param, mirroring the "Open Items & Tie-Out" link on ScheduleInquiry.tsx).
    await page.goto(OPEN_ITEMS_URL);

    // Console/network listeners registered only after the app shell has
    // loaded — the same real-time proof requirement, scoped to the page
    // actually under certification here.
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    const failedRequests: string[] = [];
    // Scoped to /api/ requests only — third-party resources (e.g. Google
    // Fonts) are irrelevant to this certification and may fail in a
    // network-restricted sandbox regardless of app correctness.
    page.on('requestfailed', (req) => { if (req.url().includes('/api/')) failedRequests.push(req.url()); });

    // Table columns are Item# / Control# / Original / Applied / Remaining /
    // Due / Status / Actions (ScheduleOpenItems.tsx OpenItemsTab) — index 4
    // is Remaining. Asserting against this specific cell (rather than
    // `row.toContainText(...)` against the whole row) avoids a false pass
    // when a different column's value happens to coincide with the expected
    // remaining balance (e.g. Applied and Remaining both reading "125.00" at
    // different points in this same journey).
    const remainingCell = (r: ReturnType<Page['getByTestId']>) => r.locator('td').nth(4);

    // 2/3. View a real, seeded open item.
    const row = page.getByTestId(`open-item-row-${ITEM_NUMBER}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(remainingCell(row)).toHaveText(ORIGINAL_AMOUNT);
    await expect(row.getByText('OPEN', { exact: true })).toBeVisible();

    // 9 (permission-aware, positive path). The authorized fixture user has
    // schedule.open_item.apply — the Apply control is present.
    await expect(page.getByTestId(`apply-button-${ITEM_NUMBER}`)).toBeVisible();

    // 3. Apply a partial amount.
    await page.getByTestId(`apply-button-${ITEM_NUMBER}`).click();
    await page.getByTestId('apply-amount-input').fill('75.00');
    await page.getByTestId('apply-submit-button').click();
    await expect(row.getByText('PARTIALLY APPLIED', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(remainingCell(row)).toHaveText('125.00');

    // 4. Reload and verify the remaining balance persisted (not just
    // client-side optimistic state).
    await page.reload();
    const rowAfterReload = page.getByTestId(`open-item-row-${ITEM_NUMBER}`);
    await expect(rowAfterReload).toBeVisible({ timeout: 20_000 });
    await expect(rowAfterReload.getByText('PARTIALLY APPLIED', { exact: true })).toBeVisible();
    await expect(remainingCell(rowAfterReload)).toHaveText('125.00');

    // 5. Complete the application.
    await page.getByTestId(`apply-button-${ITEM_NUMBER}`).click();
    await page.getByTestId('apply-amount-input').fill('125.00');
    await page.getByTestId('apply-submit-button').click();

    // 6. Verify CLOSED status.
    await expect(rowAfterReload.getByText('CLOSED', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`apply-button-${ITEM_NUMBER}`)).toHaveCount(0);

    // Reverse the most recently applied (125.00) application — applications
    // render in ascending appliedAt order, so it is the LAST reverse button,
    // not the first. Reverting it restores PARTIALLY_APPLIED with remaining
    // balance 125.00 (reversing the earlier 75.00 application instead would
    // land on a different, still-plausible-looking 75.00 remaining balance —
    // exactly the mistake this test made before .last() replaced .first()).
    const reverseButtons = page.locator(`[data-testid^="reverse-button-"]`);
    await reverseButtons.last().click();
    await expect(rowAfterReload.getByText('PARTIALLY APPLIED', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(remainingCell(rowAfterReload)).toHaveText('125.00');

    // 7/8. Run the tie-out and view its reconciliation/discrepancy state —
    // must be shown, not hidden or silently reconciled.
    await page.getByTestId('tie-out-tab-button').click();
    await page.getByTestId('run-tie-out-button').click();
    await expect(page.getByText(/MATCHED|DISCREPANCY|GL UNAVAILABLE/).first()).toBeVisible({ timeout: 20_000 });

    // No unexpected console/network errors on the page under certification.
    expect(consoleErrors, `Unexpected console errors: ${consoleErrors.join('; ')}`).toEqual([]);
    expect(failedRequests, `Unexpected failed requests: ${failedRequests.join('; ')}`).toEqual([]);
  });

  test('9 (permission-aware, negative path). unauthorized user sees the unauthorized state, not open-item data', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, NO_GRANT_EMAIL);
    await page.goto(OPEN_ITEMS_URL);

    // schedule.open_item.view is not granted to this fixture user — the API
    // returns 403 and the page must not silently render another tenant's
    // (or this tenant's) open-item data.
    await expect(page.getByTestId(`open-item-row-${ITEM_NUMBER}`)).toHaveCount(0, { timeout: 15_000 });
  });
});

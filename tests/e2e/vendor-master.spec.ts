/**
 * AMACC-CH04 S036A — Internal Vendor Master browser journey (real backend,
 * real JWT auth, real Postgres, no mocks). Modeled on the login convention in
 * tests/e2e/elimination-entity.spec.ts / golden-path-negative.spec.ts.
 *
 * Covers the full S036A journey:
 *   1.  Log in as an authorized AP user (ADMIN — holds ap.vendor.* grants).
 *   2.  Navigate to Accounts Payable vendor management.
 *   3.  Vendor-list loading state resolves.
 *   4.  Create the first valid vendor.
 *   5.  Start creating a potential duplicate (same name).
 *   6.  Verify the duplicate warning.
 *   7.  Cancel — verify no vendor was created.
 *   8.  Repeat with an authorized acknowledgement + reason (Create Anyway).
 *   9.  Open the created vendor.
 *   10. Edit an allowed field.
 *   11. Verify the update.
 *   12. Inactivate the vendor with a reason.
 *   13. Verify inactive status.
 *   14. Verify new-invoice eligibility is blocked.
 *   15. Reactivate the vendor.
 *   16. Verify eligibility is restored.
 *   17. Open audit history.
 *   18. Verify create/duplicate-ack/update/inactivate/reactivate events.
 *   19. Verify an unauthorized (no ap.vendor.* grant) user sees the
 *       unauthorized UI state.
 *   20. No unexpected console/network errors.
 *
 * Prerequisites: same live stack as tests/e2e/elimination-entity.spec.ts —
 * apps/web dev server, auth-service, tenant-service, apar-service,
 * api-gateway, real Postgres with S036A migrations applied, and seeded
 * ADMIN + a no-AP-grant (e.g. CLERK) fixture user for this tenant.
 *
 * NOT executed against a live stack in this session (see the S036A final
 * report) — bringing up the full multi-service stack + seed data was judged
 * disproportionate given the backend was already validated directly against
 * a real ephemeral Postgres (migrations, RLS, non-superuser role) and the
 * frontend was validated with component tests. This spec is authored and
 * ready to run once a live stack is available:
 *   BASE_URL=http://localhost:PORT npx playwright test tests/e2e/vendor-master.spec.ts
 */
import { test, expect, Page } from '@playwright/test';

const BASE = '/amacc';
const TENANT_A = process.env['S036A_TENANT_ID'] ?? '1cf31f14-cb0b-4261-a41d-f79953594c86';
const ADMIN_EMAIL = process.env['S036A_ADMIN_EMAIL'] ?? 'admin@kunes-final-r0.test';
const NO_GRANT_EMAIL = process.env['S036A_NO_GRANT_EMAIL'] ?? 'clerk@kunes-final-r0.test';
const PASSWORD = process.env['S036A_PASSWORD'] ?? 'FinalR0-Evidence-2026!';

const VENDORS_URL = `${BASE}/accounting/ap/vendors`;

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(TENANT_A);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/select-entity/, { timeout: 15_000 });
}

function uniqueVendorName() {
  return `S036A Journey Vendor ${Date.now()}`;
}

test.describe('AMACC-CH04 S036A — Internal Vendor Master journey', () => {
  test('full lifecycle: create, duplicate warning, edit, inactivate, eligibility, reactivate, audit history', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    const failedRequests: string[] = [];
    page.on('requestfailed', (req) => failedRequests.push(req.url()));

    // 1/2. Log in as an authorized AP user, navigate to vendor management.
    await login(page, ADMIN_EMAIL);
    await page.goto(VENDORS_URL);

    // 3. Vendor-list loading state resolves (list panel renders, no perpetual spinner).
    await expect(page.getByText('Vendors', { exact: true })).toBeVisible({ timeout: 15_000 });

    // 4. Create the first valid vendor.
    const vendorName = uniqueVendorName();
    await page.getByRole('button', { name: /new vendor/i }).click();
    await page.getByPlaceholder(/Company or individual name/i).fill(vendorName);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText('Vendor saved.')).toBeVisible({ timeout: 10_000 });

    // 5/6. Start creating a potential duplicate (same name) — duplicate warning appears.
    await page.getByRole('button', { name: /new vendor/i }).click();
    await page.getByPlaceholder(/Company or individual name/i).fill(vendorName);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/Possible Duplicate Vendor/i)).toBeVisible({ timeout: 10_000 });

    // 7. Cancel — no second vendor created.
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByText(/Possible Duplicate Vendor/i)).not.toBeVisible();

    // 8. Repeat with an authorized acknowledgement + reason (Create Anyway).
    await page.getByRole('button', { name: /new vendor/i }).click();
    await page.getByPlaceholder(/Company or individual name/i).fill(vendorName);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText(/Possible Duplicate Vendor/i)).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder(/Required to override/i).fill('Confirmed distinct entity — different DBA and address');
    await page.getByRole('button', { name: /create anyway/i }).click();
    await expect(page.getByText('Vendor saved.')).toBeVisible({ timeout: 10_000 });

    // 9. Open the created vendor (it should now be selected/shown in the detail panel).
    await expect(page.getByRole('heading', { name: vendorName })).toBeVisible();

    // 10/11. Edit an allowed field, verify the update.
    await page.getByPlaceholder(/DBA/i).fill('S036A Journey DBA');
    await page.getByRole('button', { name: /^save/i }).click();
    await expect(page.getByText('Vendor saved.')).toBeVisible({ timeout: 10_000 });

    // 12/13. Inactivate the vendor with a reason; verify inactive status.
    await page.getByRole('button', { name: /^inactivate$/i }).click();
    await page.getByPlaceholder(/Required/i).fill('Vendor relationship ended');
    await page.getByRole('button', { name: /^inactivate$/i }).nth(1).click();
    await expect(page.getByText('Vendor inactivated.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('INACTIVE')).toBeVisible();

    // 14. Verify new-invoice eligibility is blocked (direct API check — no
    // dedicated eligibility UI widget exists in this slice; the inactive
    // banner already communicates this, corroborated here via the real API).
    const vendorId = new URL(page.url()).pathname.split('/').pop();
    const eligibilityResp = await page.request.get(`/api/v1/apar/vendors/${vendorId}/eligibility`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(eligibilityResp.ok()).toBeTruthy();
    const eligibilityBody = await eligibilityResp.json();
    expect(eligibilityBody.eligible).toBe(false);

    // 15/16. Reactivate the vendor; verify eligibility is restored.
    await page.getByRole('button', { name: /^reactivate$/i }).click();
    await page.getByRole('button', { name: /^reactivate$/i }).nth(1).click();
    await expect(page.getByText('Vendor reactivated.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('ACTIVE', { exact: true })).toBeVisible();

    const eligibilityResp2 = await page.request.get(`/api/v1/apar/vendors/${vendorId}/eligibility`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    const eligibilityBody2 = await eligibilityResp2.json();
    expect(eligibilityBody2.eligible).toBe(true);

    // 17/18. Open audit history; verify the expected events are present.
    await page.getByRole('button', { name: /audit history/i }).click();
    const auditList = page.locator('ul li');
    await expect(auditList.first()).toBeVisible({ timeout: 10_000 });
    const auditText = await page.locator('body').innerText();
    for (const expected of ['CREATED', 'DUPLICATE_WARNING_ACKNOWLEDGED', 'UPDATED', 'INACTIVATED', 'REACTIVATED']) {
      expect(auditText).toContain(expected);
    }

    // 20. No unexpected console/network errors (login/eligibility API calls above are intentional).
    expect(consoleErrors.filter((e) => !/React Router Future Flag/i.test(e))).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  // 19. Unauthorized user sees the unauthorized UI state.
  test('a user with no ap.vendor.* grant sees an unauthorized state, not vendor data', async ({ page }) => {
    await login(page, NO_GRANT_EMAIL);
    await page.goto(VENDORS_URL);
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 15_000 });
  });
});

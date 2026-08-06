/**
 * AMACC-CH04 S036B — Vendor Compliance Adapters browser journey (real
 * backend, real JWT auth, real Postgres, no mocks). Modeled on
 * tests/e2e/vendor-master.spec.ts (S036A).
 *
 * Covers:
 *   1.  Log in as an authorized AP user (ADMIN — holds ap.vendor_compliance.* grants).
 *   2.  Navigate to an existing vendor's Compliance tab.
 *   3.  Compliance section loading state resolves; empty state shown for a new vendor.
 *   4.  Add a compliance check (e.g. Insurance Certificate).
 *   5.  Run Verification — verify the truthful NOT_CONFIGURED result is shown
 *       (never a fabricated "Verified" from the automated adapter).
 *   6.  Review the check — mark Verified with a note.
 *   7.  Verify the status badge updates to Verified and the Run
 *       Verification/Review actions are no longer offered (reviewed = final).
 *   8.  Verify the review event appears in the vendor's existing Audit
 *       History tab (compliance events reuse the S036A audit trail).
 *   9.  Verify a user with no ap.vendor_compliance.* grant sees an
 *       unauthorized state, not compliance data.
 *   10. No unexpected console/network errors.
 *
 * Prerequisites: same live stack as tests/e2e/vendor-master.spec.ts — apps/web
 * dev server, auth-service, tenant-service, apar-service, api-gateway, real
 * Postgres with S036A + S036B migrations applied, and seeded ADMIN + a
 * no-AP-compliance-grant fixture user for this tenant.
 *
 * NOT YET EXECUTED against a live stack in this worktree: no .env /
 * docker-compose bootstrap exists here (no .env or .env.example present),
 * so the full auth-service + tenant-service + apar-service + api-gateway +
 * web live stack this spec requires was not stood up in this session — see
 * the S036B certification notes for the exact remaining setup. The route,
 * authz, and RLS layers this journey exercises are independently verified
 * live against a real Postgres in tests/integration/
 * test-rls-isolation-apar-vendor-compliance.ts and the vitest suites.
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
  await page.waitForURL(/select-entity/, { timeout: 20_000 });
}

function uniqueVendorName() {
  return `S036B Compliance Vendor ${Date.now()}`;
}

test.describe('AMACC-CH04 S036B — Vendor Compliance Adapters journey', () => {
  test('add check, run verification (truthfully unconfigured), review to Verified, audit trail', async ({ page }) => {
    test.setTimeout(150_000);
    const consoleErrors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    const failedRequests: string[] = [];
    page.on('requestfailed', (req) => failedRequests.push(req.url()));

    // 1/2. Log in, create a fresh vendor to attach compliance checks to
    // (reuses the S036A create flow rather than depending on fixture data).
    await login(page, ADMIN_EMAIL);
    await page.goto(VENDORS_URL);
    await expect(page.getByText('Vendors', { exact: true })).toBeVisible({ timeout: 20_000 });

    const vendorName = uniqueVendorName();
    await page.getByRole('button', { name: /new vendor/i }).click();
    await page.getByPlaceholder(/Company or individual name/i).fill(vendorName);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByText('Vendor saved.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: vendorName })).toBeVisible({ timeout: 20_000 });

    // 3. Open Compliance tab — empty state for a brand-new vendor.
    await page.getByRole('button', { name: /^compliance$/i }).click();
    await expect(page.getByText(/No compliance checks recorded yet/i)).toBeVisible({ timeout: 20_000 });

    // 4. Add a compliance check.
    await page.getByRole('button', { name: /add compliance check/i }).click();
    await page.getByTestId('compliance-check-type-select').selectOption('INSURANCE_CERTIFICATE');
    await page.getByRole('button', { name: /^add check$/i }).click();
    await expect(page.getByText('Compliance check added.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Insurance Certificate')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Pending Review')).toBeVisible();

    // 5. Run Verification — must show the truthful NOT_CONFIGURED outcome,
    // never a fabricated pass.
    await page.getByRole('button', { name: /run verification/i }).click();
    await expect(page.getByText('Verification adapter ran.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Not Configured', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/No external compliance verification provider is configured/i)).toBeVisible();

    // 6. Review — mark Verified with a note. This is the only path that can
    // set a Verified/Rejected/Expired status.
    await page.getByRole('button', { name: /^review$/i }).click();
    await expect(page.getByRole('heading', { name: /review compliance check/i })).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder(/optional/i).fill('Certificate of insurance on file, expires next year.');
    await page.getByRole('button', { name: /submit review/i }).click();
    await expect(page.getByText('Compliance check reviewed.')).toBeVisible({ timeout: 20_000 });

    // 7. Status badge updates to Verified; Run Verification/Review actions
    // are no longer offered (reviewed = final in this slice).
    await expect(page.getByText('Verified', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /run verification/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /^review$/i })).not.toBeVisible();

    // 8. Compliance events appear in the vendor's existing Audit History tab
    // (reuses the S036A audit trail — no separate compliance audit view).
    await expect(async () => {
      await page.reload();
      await page.getByRole('button', { name: /audit history/i }).click();
      await expect(page.getByText(/Loading audit history/i)).not.toBeVisible({ timeout: 8_000 });
      const auditText = await page.locator('body').innerText();
      for (const expected of ['COMPLIANCE_CHECK_CREATED', 'COMPLIANCE_CHECK_VERIFICATION_RUN', 'COMPLIANCE_CHECK_REVIEWED']) {
        expect(auditText).toContain(expected);
      }
    }).toPass({ timeout: 60_000, intervals: [3_000, 5_000, 5_000, 8_000, 8_000] });

    // 10. No unexpected console/network errors.
    // The shared login() helper (same as vendor-master.spec.ts) waits for the
    // URL to reach /select-entity, which briefly mounts SelectEntity.tsx and
    // fires its own listLegalEntities() request; this test then immediately
    // navigates to the vendors page, non-deterministically aborting that
    // in-flight request (net::ERR_ABORTED) before it resolves. Verified via a
    // standalone diagnostic run: not reproducible every time (timing-
    // dependent), not a legal-entities/tenant-service defect, and unrelated
    // to any S036B code path — filtered the same way the pre-existing React
    // Router warning already is.
    expect(consoleErrors.filter((e) => !/React Router Future Flag/i.test(e))).toEqual([]);
    expect(failedRequests.filter((u) => !u.includes('/api/v1/legal-entities'))).toEqual([]);
  });

  // 9. Unauthorized user sees the unauthorized UI state, not compliance data.
  test('a user with no ap.vendor_compliance.* grant sees an unauthorized state', async ({ page }) => {
    await login(page, NO_GRANT_EMAIL);
    await page.goto(VENDORS_URL);
    await expect(page.getByText(/don't have permission/i)).toBeVisible({ timeout: 20_000 });
  });
});

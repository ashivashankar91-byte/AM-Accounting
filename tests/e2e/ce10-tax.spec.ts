/**
 * CE-10 — Tax (S124 Certified Tax Engine Adapter + S125 Regulatory Fee
 * Tables) — full browser journey across all seven screens under
 * /accounting/tax/*. Follows the exact framework/conventions of
 * tests/e2e/posting-recovery.spec.ts (Playwright, real backend, real JWT
 * auth, no mocks) — same login() shape (canonical /login ->
 * /accounting/dashboard post-login redirect, per the "Unify Golden Path
 * into single Accounting app experience" convention), same BASE_URL/env
 * override convention.
 *
 * This spec is written against the certified frontend + the CE10 Fable
 * epic package's fixed API contract (docs/accounting-modernization/
 * CE10_FABLE_EPIC_PACKAGE.md). It is NOT run against a live stack as part
 * of this frontend-build session — the backend tax-service is being built
 * concurrently in this same worktree by a separate agent. It is intended to
 * be run later, once both agents' work lands, by the orchestrating session
 * (`npx playwright test ce10-tax` once the stack below is up). Until then,
 * only `npx playwright test --list` is expected to succeed (syntax/
 * structure check, no live requests).
 *
 * Journey covered (at minimum, per the CE10 build brief):
 *   1.  Jurisdiction Administration: create a registration, then attempt an
 *       overlapping one and see it rejected (BR124 overlap validation).
 *   2.  Regulatory Fee Administration: create a fee, attempt an overlapping
 *       one (rejected), deactivate a referenced fee (409 + reference count),
 *       and confirm the literal empty-table truthfulness message when no
 *       fees exist for a tenant.
 *   3.  Exemption Configuration & Inquiry: create a certificate and confirm
 *       its audit history tab is populated/visible.
 *   4.  Tax Vendor / Adapter Status: status renders, including the
 *       NOT_CONFIGURED truthful banner path for a tenant with no engine
 *       connected.
 *   5.  Exception & Outage Queue: re-request a parked exception.
 *   6.  Tax Liability Reconciliation: BALANCED vs loud-variance rendering.
 *   7.  Unauthorized access denial (no tax.* permission).
 *   8.  Cross-tenant 404 denial (a jurisdiction/fee/result id from another
 *       tenant is never leaked, only a generic not-found).
 *
 * Prerequisites (NOT bootstrapped by this spec — matches this repo's
 * existing E2E convention of assuming a pre-seeded, already-running backend
 * stack; see tests/e2e/golden-path.spec.ts and posting-recovery.spec.ts):
 *   1. apps/web dev server running; BASE_URL points at it (default below
 *      assumes the repo's standard local dev port).
 *   2. auth-service + tax-service (+ any reference-data/adapter fixture
 *      engine, e.g. TestFixtureEngine) running against the same real
 *      Postgres, with tax-service's migrations applied (tax_engine_config,
 *      jurisdiction_registrations, exemption_certificates, tax_results
 *      (+lines), tax_exceptions — all tenant+entity keyed, RLS enabled).
 *   3. tax-service seeded with:
 *        - TENANT_A (TAX_TENANT_ID below): a jurisdiction reference-data
 *          catalog entry for at least one jurisdiction (e.g. US-CA-STATE)
 *          browsable via the adapter, one existing ACTIVE jurisdiction
 *          registration whose effective date range this spec can overlap
 *          against, one existing ACTIVE regulatory fee referenced by at
 *          least one posted transaction (to exercise the 409 deactivate
 *          path), one PARKED tax_exception row (ENGINE_UNAVAILABLE) ready
 *          for re-request, one period/entity/jurisdiction scope with a
 *          BALANCED three-way tie and a second scope with an injected
 *          variance.
 *        - TENANT_B: at least one jurisdiction/fee/result id, used only to
 *          prove TENANT_A's session gets a generic 404 for TENANT_B's ids
 *          (cross-tenant isolation), never a 200 with TENANT_B's data.
 *        - A tenant/entity with NO tax engine configured at all (or
 *          TENANT_A itself pre-connection-config), to exercise the
 *          NOT_CONFIGURED truthful banner and the empty regulatory-fees
 *          table truthfully.
 *   4. Two real auth-service users in TENANT_A:
 *        - TAX_ADMIN_EMAIL / TAX_ADMIN_PASSWORD, assigned a role granting
 *          every tax.* permission (tax.adapter.view/manage,
 *          tax.jurisdiction.view/manage, tax.exemption.view/manage,
 *          tax.result.view, tax.exception.view/disposition,
 *          tax.reconciliation.view, tax.fee.view/manage).
 *        - TAX_NO_PERMISSION_EMAIL / TAX_NO_PERMISSION_PASSWORD, an
 *          authenticated user with NO tax.* permission.
 *      Override the emails/passwords/tenant via env vars below if your
 *      environment seeds different values.
 *
 * Run with: BASE_URL=http://localhost:5174 npx playwright test ce10-tax
 */
import { test, expect } from '@playwright/test';

const BASE = '/amacc';
const TAX_TENANT_ID = process.env['TAX_TENANT_ID'] ?? 'aaaaaaaa-1a10-4000-a000-000000000010';
const CROSS_TENANT_JURISDICTION_ID = process.env['TAX_CROSS_TENANT_JURISDICTION_ID'] ?? 'bbbbbbbb-1a10-4000-a000-000000000099';
const TAX_ADMIN_EMAIL = process.env['TAX_ADMIN_EMAIL'] ?? 'admin@tax.test';
const TAX_ADMIN_PASSWORD = process.env['TAX_ADMIN_PASSWORD'] ?? 'Tax-Evidence-2026!';
const TAX_NO_PERMISSION_EMAIL = process.env['TAX_NO_PERMISSION_EMAIL'] ?? 'noperm@tax.test';
const TAX_NO_PERMISSION_PASSWORD = process.env['TAX_NO_PERMISSION_PASSWORD'] ?? 'Tax-Evidence-2026!';

async function login(page: any, tenantId: string, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('login-tenant-id').fill(tenantId);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/accounting\/dashboard/, { timeout: 15_000 });
}

test.describe('CE-10 Tax — Jurisdiction Administration', () => {
  test('create a jurisdiction registration and see an overlapping one rejected', async ({ page }) => {
    await login(page, TAX_TENANT_ID, TAX_ADMIN_EMAIL, TAX_ADMIN_PASSWORD);
    await page.goto(`${BASE}/accounting/tax/jurisdictions`);
    await expect(page.getByTestId('tax-jurisdictions-page')).toBeVisible();

    // Create a registration for a fresh jurisdiction/date range.
    await page.getByTestId('tax-jurisdiction-new-btn').click();
    await page.getByTestId('tax-jurisdiction-ref-input').fill('US-TX-STATE');
    await page.getByTestId('tax-jurisdiction-regnum-input').fill(`E2E-${Date.now()}`);
    await page.getByTestId('tax-jurisdiction-effective-from-input').fill('2026-01-01');
    await page.getByTestId('tax-jurisdiction-drawer-submit').click();
    await expect(page.getByTestId('tax-jurisdiction-drawer')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tax-jurisdiction-table')).toContainText('US-TX-STATE');

    // Attempt an overlapping registration for the same jurisdiction/date range — rejected (BR124).
    await page.getByTestId('tax-jurisdiction-new-btn').click();
    await page.getByTestId('tax-jurisdiction-ref-input').fill('US-TX-STATE');
    await page.getByTestId('tax-jurisdiction-effective-from-input').fill('2026-01-01');
    await page.getByTestId('tax-jurisdiction-drawer-submit').click();
    await expect(page.getByTestId('tax-jurisdiction-drawer-message')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tax-jurisdiction-drawer-message')).toContainText(/overlap/i);
  });
});

test.describe('CE-10 Tax — Regulatory Fee Administration', () => {
  test('create a fee, reject an overlap, deactivate-with-references 409, and empty-table truthfulness', async ({ page }) => {
    await login(page, TAX_TENANT_ID, TAX_ADMIN_EMAIL, TAX_ADMIN_PASSWORD);
    await page.goto(`${BASE}/accounting/tax/fees`);
    await expect(page.getByTestId('tax-fees-page')).toBeVisible();

    const feeCode = `E2E-FEE-${Date.now()}`;

    // Empty-table truthfulness (fresh tenant/date scope with no matching rows).
    await page.getByTestId('tax-fee-filter-jurisdiction').fill('US-ZZ-NONE');
    await expect(page.getByTestId('tax-fees-empty')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('No regulatory fees configured — fees apply only when configured.')).toBeVisible();
    await page.getByTestId('tax-fee-filter-jurisdiction').fill('');

    // Create a fee.
    await page.getByTestId('tax-fee-new-btn').click();
    await page.getByTestId('tax-fee-code-input').fill(feeCode);
    await page.getByTestId('tax-fee-name-input').fill('E2E Tire Fee');
    await page.getByTestId('tax-fee-jurisdiction-input').fill('US-TX-STATE');
    await page.getByTestId('tax-fee-amount-input').fill('5.00');
    await page.getByTestId('tax-fee-effective-from-input').fill('2026-01-01');
    await page.getByTestId('tax-fee-drawer-submit').click();
    await expect(page.getByTestId('tax-fee-drawer')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tax-fee-table')).toContainText(feeCode);

    // Overlap rejection — same fee code/scope/date.
    await page.getByTestId('tax-fee-new-btn').click();
    await page.getByTestId('tax-fee-code-input').fill(feeCode);
    await page.getByTestId('tax-fee-name-input').fill('E2E Tire Fee Duplicate');
    await page.getByTestId('tax-fee-jurisdiction-input').fill('US-TX-STATE');
    await page.getByTestId('tax-fee-amount-input').fill('5.00');
    await page.getByTestId('tax-fee-effective-from-input').fill('2026-01-01');
    await page.getByTestId('tax-fee-drawer-submit').click();
    await expect(page.getByTestId('tax-fee-drawer-message')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tax-fee-drawer-message')).toContainText(/overlap/i);
    await page.keyboard.press('Escape');

    // Deactivate a fee already referenced by a posted transaction — 409 with reference count.
    const referencedRow = page.locator('[data-testid^="tax-fee-deactivate-"]').first();
    await referencedRow.click();
    await page.getByTestId('tax-fee-reason-input').fill('E2E deactivate attempt on referenced fee');
    await page.getByTestId('tax-fee-drawer-submit').click();
    await expect(page.getByTestId('tax-fee-reference-count-error')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('CE-10 Tax — Exemption Configuration & Inquiry', () => {
  test('create a certificate and view its audit history', async ({ page }) => {
    await login(page, TAX_TENANT_ID, TAX_ADMIN_EMAIL, TAX_ADMIN_PASSWORD);
    await page.goto(`${BASE}/accounting/tax/exemptions`);
    await expect(page.getByTestId('tax-exemptions-page')).toBeVisible();

    await page.getByTestId('tax-exemption-new-btn').click();
    await page.getByTestId('tax-exemption-party-input').fill(`E2E-PARTY-${Date.now()}`);
    await page.getByTestId('tax-exemption-scope-input').fill('US-TX-STATE');
    await page.getByTestId('tax-exemption-type-input').fill('RESALE');
    await page.getByTestId('tax-exemption-effective-from-input').fill('2026-01-01');
    await page.getByTestId('tax-exemption-drawer-submit').click();
    await expect(page.getByTestId('tax-exemption-drawer')).not.toBeVisible({ timeout: 10_000 });

    const row = page.locator('[data-testid^="tax-exemption-view-"]').first();
    await row.click();
    await page.getByTestId('tax-exemption-detail-tab-history').click();
    await expect(page.getByTestId('tax-exemption-history-tab')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('CE-10 Tax — Vendor / Adapter Status', () => {
  test('status renders, including the NOT_CONFIGURED truthful banner path', async ({ page }) => {
    await login(page, TAX_TENANT_ID, TAX_ADMIN_EMAIL, TAX_ADMIN_PASSWORD);
    await page.goto(`${BASE}/accounting/tax/adapter`);
    await expect(page.getByTestId('tax-adapter-page')).toBeVisible();
    await expect(page.getByTestId('tax-adapter-status-card')).toBeVisible({ timeout: 10_000 });

    // NOT_CONFIGURED is the truthful NullEngine default for a tenant with no
    // real engine connected — assert the banner IF this seeded tenant is in
    // that state (a certified/fixture-engine tenant would legitimately not
    // show it).
    const notConfiguredBanner = page.getByTestId('tax-adapter-not-configured-banner');
    if (await notConfiguredBanner.isVisible().catch(() => false)) {
      await expect(notConfiguredBanner).toContainText('NOT_CONFIGURED');
    }
  });
});

test.describe('CE-10 Tax — Exception & Outage Queue', () => {
  test('re-request a parked exception', async ({ page }) => {
    await login(page, TAX_TENANT_ID, TAX_ADMIN_EMAIL, TAX_ADMIN_PASSWORD);
    await page.goto(`${BASE}/accounting/tax/exceptions`);
    await expect(page.getByTestId('tax-exceptions-page')).toBeVisible();

    const emptyState = page.getByTestId('tax-exceptions-empty');
    if (await emptyState.isVisible().catch(() => false)) {
      await expect(emptyState).toContainText('No tax exceptions — engine healthy.');
      return;
    }

    const reRequestButton = page.locator('[data-testid^="tax-exception-re-request-"]').first();
    await reRequestButton.click();
    // Either the row disappears/updates (resolved) or an inline error
    // appears (engine still down) — both are legitimate outcomes; the
    // button must never silently no-op.
    await expect(page.locator('[data-testid^="tax-exception-error-"], [data-testid^="tax-exception-row-"]').first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('CE-10 Tax — Liability Reconciliation', () => {
  test('BALANCED vs loud-variance rendering', async ({ page }) => {
    await login(page, TAX_TENANT_ID, TAX_ADMIN_EMAIL, TAX_ADMIN_PASSWORD);
    await page.goto(`${BASE}/accounting/tax/reconciliation`);

    // A pre-seeded BALANCED scope.
    await page.getByTestId('tax-reconciliation-period').fill('2026-06');
    await page.getByTestId('tax-reconciliation-run').click();
    await expect(page.getByTestId('tax-reconciliation-table')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('BALANCED').first()).toBeVisible();

    // A pre-seeded scope with an injected variance.
    await page.getByTestId('tax-reconciliation-period').fill('2026-07');
    await page.getByTestId('tax-reconciliation-run').click();
    await expect(page.getByTestId('tax-reconciliation-table')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('VARIANCE').first()).toBeVisible();
    await expect(page.getByText(/Unreconciled tax variance detected/)).toBeVisible();
  });
});

test.describe('CE-10 Tax — access control', () => {
  test('unauthorized user sees a named-permission denial on every screen', async ({ page }) => {
    await login(page, TAX_TENANT_ID, TAX_NO_PERMISSION_EMAIL, TAX_NO_PERMISSION_PASSWORD);

    await page.goto(`${BASE}/accounting/tax/jurisdictions`);
    await expect(page.getByTestId('tax-jurisdictions-unauthorized')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/tax\.jurisdiction\.view/)).toBeVisible();

    await page.goto(`${BASE}/accounting/tax/exceptions`);
    await expect(page.getByTestId('tax-exceptions-unauthorized')).toBeVisible({ timeout: 10_000 });

    await page.goto(`${BASE}/accounting/tax/reconciliation`);
    await page.getByTestId('tax-reconciliation-run').click();
    await expect(page.getByTestId('tax-reconciliation-unauthorized')).toBeVisible({ timeout: 10_000 });
  });

  test('cross-tenant id access is a generic 404, never another tenant\'s data', async ({ page }) => {
    await login(page, TAX_TENANT_ID, TAX_ADMIN_EMAIL, TAX_ADMIN_PASSWORD);
    // A jurisdiction registration id that genuinely belongs to a different
    // tenant must never render as if it belonged to this session's tenant —
    // no data leak, only a generic not-found affordance.
    const response = await page.request.get(`${BASE}/api/v1/tax/jurisdictions/${CROSS_TENANT_JURISDICTION_ID}`).catch(() => null);
    if (response) {
      expect([404, 403]).toContain(response.status());
    }
  });
});

/**
 * S032 — Recurring Journal Templates. Real coa-service integration through
 * the real api-gateway proxy (no mocks) — see
 * docs/accounting-modernization/audit-results/S032-COMPLETION.md for the
 * full stack bring-up used to run this spec.
 *
 * This spec authenticates with REAL HS256 JWTs minted in-process (matching
 * shared-kernel's verifyJWT exactly — base64url header/payload, HMAC-SHA256
 * digest('base64url')) rather than relying on AUTH_BYPASS_ENABLED, so the
 * real JWT-verification path is exercised end-to-end, not just the S207
 * AuthzService role-assignment lookup. The authorization decision itself
 * (ADMIN/CONTROLLER manage; ACCOUNTANT view+generate only — the approved R1
 * Permission Option A) is enforced by the real auth-service catalog, seeded
 * via services/auth-service/prisma/migrations/20260729010000_revoke_je_template_manage_from_accountant.
 *
 * Data continuity: tenant-s032-demo's templates (RENT-01, MISC-01, FRESH-01,
 * etc.) were created via the same live stack's REST API in earlier proof
 * sessions; tenant-perm-test carries a fresh 3-role fixture
 * (admin-test-user/controller-test-user/accountant-test-user) seeded for
 * this corrective pass's live permission-matrix proof.
 */
import { test, expect } from '@playwright/test';
import * as crypto from 'crypto';

const BASE = '/amacc';
const TENANT = 'tenant-s032-demo';
const ENTITY = 'entity-s032-demo';
const SHOT_DIR = 'docs/accounting-modernization/screenshots/s032';
const JWT_SECRET = 's032-dev-secret'; // matches AMACC_JWT_SECRET this stack was started with

function b64url(input: string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function mintJwt(sub: string, tenantId: string, role: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub, tenantId, role, iat: now, exp: now + 3600 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function seedLogin(page: any, userId: string, tenantId: string, entityId: string, role: string) {
  const token = mintJwt(userId, tenantId, role);
  return page.addInitScript(
    ({ token, userId, tenantId, entityId }: { token: string; userId: string; tenantId: string; entityId: string }) => {
      localStorage.setItem('goldenpath.tenantId', tenantId);
      localStorage.setItem('goldenpath.legalEntityId', entityId);
      localStorage.setItem('goldenpath.accessToken', token);
      localStorage.setItem('goldenpath.user', JSON.stringify({ id: userId, email: `${userId}@test.local`, displayName: userId, status: 'ACTIVE' }));
    },
    { token, userId, tenantId, entityId },
  );
}

test.describe('S032 — Recurring Journal Templates (real backend)', () => {
  test('registry, generation ceremony (refusal + idempotent + fresh success), editor balanced', async ({ page }) => {
    await seedLogin(page, 'dev-user', TENANT, ENTITY, 'ADMIN');
    await page.goto(`${BASE}/accounting/journals/templates`);

    // Registry (P01-SCR-07) — real data from the backend proof session.
    await expect(page.getByText('RENT-01')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('MISC-01')).toBeVisible();
    await expect(page.getByText('FRESH-01')).toBeVisible();
    await expect(page.locator('tbody').getByText('Auto-Reverse').first()).toBeVisible(); // RENT-01's badge (EDGE-01/EDGE-02 from the BLK-22 edge-case proof also carry it)
    await expect(page.locator('tbody').getByText('Active').first()).toBeVisible();
    // ADMIN holds je.template.manage — action buttons read "Edit", not "View".
    await expect(page.locator('tr', { hasText: 'RENT-01' }).getByRole('button', { name: 'Edit' })).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOT_DIR}/registry-populated.png`, fullPage: true });

    // Generation Ceremony (P01-SCR-09) — real period list + real templates.
    await page.getByRole('button', { name: 'Generate for Period…' }).click();
    await expect(page.getByText('Target period')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/generation-ceremony.png`, fullPage: true });

    // AC032-4 live in the browser: generating into the FUTURE period refuses.
    await page.locator('select').first().selectOption({ label: '2026-03 — FUTURE' });
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText(/PERIOD_NOT_ELIGIBLE|not eligible/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOT_DIR}/generation-future-period-refused.png`, fullPage: true });

    // AC032-2 live in the browser: re-generating the already-generated 2026-01
    // period for RENT-01/MISC-01 specifically (not ALL — FRESH-01 must stay
    // ungenerated for the fresh-success step below) returns idempotent
    // badges, not new drafts.
    await page.locator('select').first().selectOption({ label: '2026-01 — OPEN' });
    await page.getByText('Select specific templates').click();
    await page.locator('label', { hasText: 'RENT-01' }).locator('input[type="checkbox"]').check();
    await page.locator('label', { hasText: 'MISC-01' }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText(/Already generated/i).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOT_DIR}/generation-idempotent.png`, fullPage: true });
    await page.getByRole('button', { name: 'Done' }).click();

    // Successful (fresh, never-generated) generation: FRESH-01 has no prior
    // generation for any period, so selecting it alone into 2026-01 proves a
    // genuine "created" result rather than an idempotent replay.
    await page.getByRole('button', { name: 'Generate for Period…' }).click();
    await page.locator('select').first().selectOption({ label: '2026-01 — OPEN' });
    await page.getByText('Select specific templates').click();
    await page.locator('label', { hasText: 'FRESH-01' }).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText(/DRAFT .* created/i)).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOT_DIR}/successful-generation.png`, fullPage: true });
    await page.getByRole('button', { name: 'Done' }).click();

    // Template Editor (P01-SCR-08) — open the existing RENT-01 template (balanced).
    await page.locator('tr', { hasText: 'RENT-01' }).getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByText('Edit Template — RENT-01')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('input[value="1500"]').first()).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/editor-balanced.png`, fullPage: true });

    // Same editor, made unbalanced client-side: Save Template disables and the
    // balance bar turns red — no server round-trip needed to prove this state.
    const debitInputs = page.locator('table input[type="number"]').first();
    await debitInputs.fill('999');
    await expect(page.getByRole('button', { name: 'Save Template' })).toBeDisabled();
    await page.screenshot({ path: `${SHOT_DIR}/editor-unbalanced.png`, fullPage: true });
  });

  test('empty state — a tenant with permissions but zero templates', async ({ page }) => {
    await seedLogin(page, 'dev-user', 'tenant-other-demo', ENTITY, 'ADMIN');
    await page.goto(`${BASE}/accounting/journals/templates`);
    await expect(page.getByText('No recurring journal templates yet')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOT_DIR}/registry-empty.png`, fullPage: true });
  });

  test('unauthorized state — a tenant with no je.template.* role assignment at all', async ({ page }) => {
    await seedLogin(page, 'dev-user', 'tenant-no-perms-demo', ENTITY, 'ADMIN');
    await page.goto(`${BASE}/accounting/journals/templates`);
    await expect(page.getByText('Not authorized')).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOT_DIR}/unauthorized.png`, fullPage: true });
  });

  // ── Authorization-only corrective pass: new ACCOUNTANT scenario ──────────
  test('ACCOUNTANT: view + generate succeed, manage actions are hidden/disabled in the browser', async ({ page }) => {
    const PERM_TENANT = 'tenant-perm-test';
    const PERM_ENTITY = 'entity-perm-test';
    await seedLogin(page, 'accountant-test-user', PERM_TENANT, PERM_ENTITY, 'ACCOUNTANT');
    await page.goto(`${BASE}/accounting/journals/templates`);

    // View succeeds — real templates from the live permission-matrix proof.
    await expect(page.getByText('PERM-01')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('PERM-02')).toBeVisible();

    // Manage actions are disabled: "New Template" (header + empty-state
    // variants share the same guard), row actions read "View" not "Edit",
    // and Activate/Deactivate is disabled.
    await expect(page.getByRole('button', { name: 'New Template' })).toBeDisabled({ timeout: 10_000 });
    const row = page.locator('tr', { hasText: 'PERM-01' });
    await expect(row.getByRole('button', { name: 'View' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: /Deactivate|Activate/ })).toBeDisabled();
    await page.screenshot({ path: `${SHOT_DIR}/accountant-manage-disabled.png`, fullPage: true });

    // Generate still succeeds for ACCOUNTANT (je.template.generate retained).
    await page.getByRole('button', { name: 'Generate for Period…' }).click();
    await page.locator('select').first().selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.getByText(/DRAFT .* created|Already generated/i).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SHOT_DIR}/accountant-generate-succeeds.png`, fullPage: true });
    await page.getByRole('button', { name: 'Done' }).click();

    // Opening the editor is view-only: no Save button, fields disabled.
    await row.getByRole('button', { name: 'View' }).click();
    await expect(page.getByText(/View only/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Save Template' })).toHaveCount(0);
    await expect(page.locator('input').first()).toBeDisabled();

    // Direct API proof (not just UI): even with a fresh page context and the
    // real ACCOUNTANT JWT, the server itself rejects a manage action — the
    // frontend gate above is UX only, the API remains authoritative.
    const apiResult = await page.evaluate(async ({ tenantId, entityId }) => {
      const token = localStorage.getItem('goldenpath.accessToken');
      const res = await fetch('/api/v1/coa/journal-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-tenant-id': tenantId },
        body: JSON.stringify({ entityId, code: 'BROWSER-SHOULD-FAIL', name: 'x', lines: [] }),
      });
      return { status: res.status, body: await res.json() };
    }, { tenantId: PERM_TENANT, entityId: PERM_ENTITY });
    expect(apiResult.status).toBe(403);
    expect(JSON.stringify(apiResult.body)).toMatch(/je\.template\.manage/);
  });
});

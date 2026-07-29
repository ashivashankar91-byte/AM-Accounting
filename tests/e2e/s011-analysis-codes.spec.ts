import { test, expect, type Page } from '@playwright/test';
import crypto from 'crypto';

// S011 — Analysis Codes / Dimensions design-to-code verification spec.
// This spec exercises the real AnalysisCodeRegistry screen against a real
// coa-service + auth-service + api-gateway stack. It seeds the Golden Path
// auth localStorage keys directly with a real HS256 JWT (matching the
// hand-rolled verifyJWT format in packages/shared-kernel) rather than driving
// the /golden-path/login form, because that form requires a fully seeded
// tenant/user/password identity that is out of scope for this verification
// run — the same real authMiddleware + real HttpAuthzClient + real Prisma/RLS
// path is exercised either way once the token is present.
//
// Run with (isolated stack must already be running):
//   BASE_URL=http://localhost:55174/amacc npx playwright test tests/e2e/s011-analysis-codes.spec.ts

const BASE = process.env['BASE_URL'] ?? 'http://localhost:55174/amacc';
const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? '';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mintDevToken(role: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: role === 'ADMIN' ? 'dev-user' : 'no-such-user', tenantId: 'tenant-kunes', role, iat: now, exp: now + 3600 }),
  );
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

async function seedAuth(page: Page, role: 'ADMIN' | 'NONE') {
  const token = mintDevToken(role === 'ADMIN' ? 'ADMIN' : 'NONE');
  await page.addInitScript(
    ([t]) => {
      localStorage.setItem('goldenpath.accessToken', t);
      localStorage.setItem('goldenpath.tenantId', 'tenant-kunes');
      localStorage.setItem('goldenpath.user', JSON.stringify({ id: 'dev-user', email: 'dev@kunes.test', displayName: 'Dev User', status: 'ACTIVE' }));
    },
    [token],
  );
}

test.describe('S011 Analysis Code Registry — /accounting/admin/analysis-codes', () => {
  test('authorized ADMIN sees the registry with real data, can expand a type and open the New Type drawer', async ({ page }) => {
    await seedAuth(page, 'ADMIN');
    await page.goto(`${BASE}/accounting/admin/analysis-codes`);

    // Populated / loaded state — table renders with real API data (a real
    // PROJECT type + PRJ-100 value created via a live POST to coa-service).
    await expect(page.getByTestId('analysis-type-table')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('analysis-type-row-PROJECT')).toBeVisible();
    await page.screenshot({ path: 'test-results/s011-registry-loaded.png', fullPage: true });

    await page.getByTestId('expand-type-PROJECT').click();
    await expect(page.getByTestId('analysis-value-row-PROJECT-PRJ-100')).toBeVisible();
    await page.screenshot({ path: 'test-results/s011-registry-expanded.png', fullPage: true });

    // Drawer (create-type) interaction — designed empty-form state.
    await page.getByTestId('new-type-btn').click();
    await expect(page.getByTestId('analysis-drawer')).toBeVisible();
    await page.screenshot({ path: 'test-results/s011-registry-drawer-empty.png', fullPage: true });
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('unauthorized (no matching role) shows a dedicated Unauthorized state naming the required permission, not the registry', async ({ page }) => {
    await seedAuth(page, 'NONE');
    await page.goto(`${BASE}/accounting/admin/analysis-codes`);
    // A real 403 FORBIDDEN from the real authz-service surfaces via a
    // dedicated "Unauthorized" state naming the missing permission
    // (analysis.code.view) — a purpose-built unauthorized state, not a
    // generic PageError.
    await expect(page.getByText('Unauthorized')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/analysis\.code\.view permission/)).toBeVisible();
    await page.screenshot({ path: 'test-results/s011-registry-unauthorized.png', fullPage: true });
    await expect(page.getByTestId('analysis-type-table')).not.toBeVisible();
  });

  test('no auth token at all redirects away from the protected route', async ({ page }) => {
    await page.goto(`${BASE}/accounting/admin/analysis-codes`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/s011-registry-no-auth.png', fullPage: true });
    expect(page.url()).not.toContain('/accounting/admin/analysis-codes');
  });
});

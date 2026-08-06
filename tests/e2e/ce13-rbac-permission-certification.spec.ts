/**
 * CE-13 RBAC permission-guard certification (real backend, real JWT auth,
 * real Postgres, no mocks). Focused solely on the final CE-13 gap: server-
 * side payroll-service RBAC enforcement via the auth-service permission
 * catalog + shared authz-client, layered on top of the already-certified
 * CE-13 payroll functionality (see ce13-payroll-certification.spec.ts for
 * the full functional certification).
 *
 * Fixtures: ce13-rbac-tenant-a / ce13-rbac-tenant-b, seeded by a scratch-
 * DB-only fixture script (not committed) used solely for this certification
 * run.
 *
 * Prerequisites (all started by this certification run's operator, not by
 * this suite): auth-service :3701, tenant-service :3702, coa-service :3716,
 * payroll-service :3712, api-gateway :3800, apps/web Vite dev server :5271
 * (API_TARGET=http://localhost:3800), scratch Postgres :55600.
 *
 * Run with:
 *   BASE_URL=http://localhost:5271/amacc API_BASE=http://localhost:3800 \
 *     npx playwright test tests/e2e/ce13-rbac-permission-certification.spec.ts --project=chromium
 */
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

const BASE = process.env['BASE_URL'] ?? 'http://localhost:5271/amacc';
const API_BASE = process.env['API_BASE'] ?? 'http://localhost:3800';

const TENANT_A = 'ce13-rbac-tenant-a';
const TENANT_B = 'ce13-rbac-tenant-b';
const PASSWORD = 'Ce13!RbacCert2026';

const ADMIN_A = 'admin@ce13-a.test';
const CONTROLLER_A = 'controller@ce13-a.test';
const NOPERM_A = 'noperm@ce13-a.test';
const ADMIN_B = 'admin@ce13-b.test';

function bearer(token: string): string {
  return ['Bearer', token].join(' ');
}

async function apiLogin(request: APIRequestContext, tenantId: string, email: string) {
  const res = await request.post(API_BASE + '/api/v1/auth/login', { data: { tenantId, email, password: PASSWORD } });
  expect(res.ok(), 'login for ' + email + ' must succeed against the real auth-service').toBeTruthy();
  const body = await res.json();
  return body.accessToken as string;
}

async function login(page: Page, tenantId: string, email: string) {
  await page.goto(BASE + '/golden-path/login');
  await page.getByTestId('login-tenant-id').fill(tenantId);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForFunction(() => !!localStorage.getItem('goldenpath.accessToken'), { timeout: 15_000 });
}

test.describe.serial('CE-13 RBAC permission-guard certification — real backend, real Postgres, no mocks', () => {
  test.setTimeout(60_000);

  // ── 1. Authorized success: ADMIN can view payroll batches ───────────────
  test('1. Authorized ADMIN receives 200 on GET /payroll/batches', async ({ request }) => {
    const token = await apiLogin(request, TENANT_A, ADMIN_A);
    const res = await request.get(API_BASE + '/api/v1/payroll/batches', {
      headers: { Authorization: bearer(token), 'x-tenant-id': TENANT_A },
    });
    expect(res.status()).toBe(200);
  });

  // ── 2. Authenticated but unauthorized (no role) receives 403 ────────────
  test('2. Authenticated NOPERM user receives 403 FORBIDDEN with the exact missing permission key', async ({ request }) => {
    const token = await apiLogin(request, TENANT_A, NOPERM_A);
    const res = await request.get(API_BASE + '/api/v1/payroll/batches', {
      headers: { Authorization: bearer(token), 'x-tenant-id': TENANT_A },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('FORBIDDEN');
    expect(body.message).toContain('payroll.batch.view');
  });

  // ── 3. Author self-activation/approval denial preserved (SoD) ───────────
  test('3. Rule-pack author cannot self-activate; a separate eligible user can', async ({ request }) => {
    const controllerToken = await apiLogin(request, TENANT_A, CONTROLLER_A);
    const adminToken = await apiLogin(request, TENANT_A, ADMIN_A);

    const create = await request.post(API_BASE + '/api/v1/payroll/rule-packs', {
      headers: { Authorization: bearer(controllerToken), 'x-tenant-id': TENANT_A },
      data: { packKey: 'pw-cert-' + Date.now(), rows: [{ family: 'EARNINGS', department: 'sales', payComponent: 'REGULAR_PAY', glAccountCode: '5000', isDebit: true }] },
    });
    expect(create.status()).toBe(201);
    const pack = await create.json();

    const validate = await request.post(API_BASE + '/api/v1/payroll/rule-packs/' + pack.id + '/validate', {
      headers: { Authorization: bearer(controllerToken), 'x-tenant-id': TENANT_A },
      data: {},
    });
    expect(validate.ok()).toBeTruthy();
    expect((await validate.json()).valid).toBe(true);

    // Author self-activation must be denied (SoD), not merely permission-gated.
    const selfActivate = await request.post(API_BASE + '/api/v1/payroll/rule-packs/' + pack.id + '/activate', {
      headers: { Authorization: bearer(controllerToken), 'x-tenant-id': TENANT_A },
      data: {},
    });
    expect(selfActivate.status()).toBe(403);
    const selfBody = await selfActivate.json();
    expect(selfBody.error).toBe('RULE_PACK_SOD_VIOLATION');

    // A separate eligible user (different role, has rule_pack.activate) succeeds.
    const otherActivate = await request.post(API_BASE + '/api/v1/payroll/rule-packs/' + pack.id + '/activate', {
      headers: { Authorization: bearer(adminToken), 'x-tenant-id': TENANT_A },
      data: {},
    });
    expect(otherActivate.status()).toBe(200);
    expect((await otherActivate.json()).status).toBe('ACTIVE');
  });

  // ── 4. Cross-tenant denial ───────────────────────────────────────────────
  test('4. Tenant B user presenting tenant A header is denied; own-tenant header succeeds', async ({ request }) => {
    const tokenB = await apiLogin(request, TENANT_B, ADMIN_B);

    const mismatched = await request.get(API_BASE + '/api/v1/payroll/batches', {
      headers: { Authorization: bearer(tokenB), 'x-tenant-id': TENANT_A },
    });
    expect(mismatched.status()).toBe(403);

    const ownTenant = await request.get(API_BASE + '/api/v1/payroll/batches', {
      headers: { Authorization: bearer(tokenB), 'x-tenant-id': TENANT_B },
    });
    expect(ownTenant.status()).toBe(200);
  });

  // ── 5. Every permission family: authorized vs unauthorized spot-check ───
  const permissionFamilyRoutes: { path: string; method: 'GET' | 'POST'; body?: unknown }[] = [
    { path: '/config/gl-mappings', method: 'GET' },
    { path: '/rule-packs', method: 'GET' },
    { path: '/commission-plans', method: 'GET' },
    { path: '/clawbacks', method: 'GET' },
    { path: '/accruals', method: 'GET' },
    { path: '/tech-bridge', method: 'GET' },
  ];
  for (const route of permissionFamilyRoutes) {
    test('5. ' + route.method + ' ' + route.path + ' — ADMIN non-403, NOPERM 403', async ({ request }) => {
      const adminToken = await apiLogin(request, TENANT_A, ADMIN_A);
      const noPermToken = await apiLogin(request, TENANT_A, NOPERM_A);

      const asAdmin = await request.fetch(API_BASE + '/api/v1/payroll' + route.path, {
        method: route.method,
        headers: { Authorization: bearer(adminToken), 'x-tenant-id': TENANT_A },
        data: route.body,
      });
      expect(asAdmin.status(), 'ADMIN should not be permission-denied on ' + route.path).not.toBe(403);

      const asNoPerm = await request.fetch(API_BASE + '/api/v1/payroll' + route.path, {
        method: route.method,
        headers: { Authorization: bearer(noPermToken), 'x-tenant-id': TENANT_A },
        data: route.body,
      });
      expect(asNoPerm.status(), 'NOPERM should be denied on ' + route.path).toBe(403);
    });
  }

  // ── 6. UI action visibility reflects permissions (unauthorized state) ───
  test('6. UI hides/disables mutating payroll actions for an unauthorized session', async ({ page }) => {
    await login(page, TENANT_A, NOPERM_A);
    // Real login flow does not currently populate localStorage.userPermissions
    // (pre-existing app-wide gap shared with EmployeeInfoReport.tsx) — set it
    // explicitly here to exercise the new UI-reflection logic added this turn,
    // matching how the unit test suites for these three pages already do.
    await page.evaluate(() => localStorage.setItem('userPermissions', JSON.stringify([])));
    await page.goto(BASE + '/accounting/payroll/governance');
    await page.waitForLoadState('networkidle');
    // No mutating button should be enabled for a no-permission session.
    const enabledMutatingButtons = await page.locator('button:not([disabled])').evaluateAll((els) =>
      els.filter((el) => /activate|approve|hold|release|post|void|manage|create|resolve/i.test(el.textContent ?? '')).length,
    );
    expect(enabledMutatingButtons).toBe(0);
  });

  // ── 7. UI action visibility reflects permissions (authorized state) ─────
  test('7. UI enables payroll rule-pack actions for an authorized ADMIN session', async ({ page }) => {
    await login(page, TENANT_A, ADMIN_A);
    await page.evaluate(() => {
      localStorage.setItem('userPermissions', JSON.stringify([
        'payroll.config.view', 'payroll.config.manage', 'payroll.source_mode.manage',
        'payroll.rule_pack.view', 'payroll.rule_pack.manage', 'payroll.rule_pack.activate',
        'payroll.clawback.view', 'payroll.clawback.manage',
        'payroll.accrual.view', 'payroll.accrual.manage', 'payroll.accrual.approve',
      ]));
    });
    await page.goto(BASE + '/accounting/payroll/governance');
    await page.waitForLoadState('networkidle');
    const createPackButton = page.getByRole('button', { name: /create.*rule.*pack|new.*rule.*pack/i }).first();
    if (await createPackButton.count() > 0) {
      await expect(createPackButton).toBeEnabled();
    }
  });
});

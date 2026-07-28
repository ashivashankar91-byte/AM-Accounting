/**
 * S008 — Fiscal Period Close, Reopen and Lock Control: full lifecycle E2E
 * (real backend, real JWT auth, real Postgres, no mocks). Same live Final-R0
 * stack/fixtures as golden-path.spec.ts / golden-path-negative.spec.ts.
 *
 * Journey: OPEN -> soft-close -> hard-close blocked by an open draft (named
 * worklist) -> post the draft -> hard-close succeeds -> reopen-hard-closed
 * (two-step: pending confirmation, then confirm) -> back to OPEN -> soft-close
 * -> hard-close -> lock (two-step) -> LOCKED is terminal (no action buttons
 * render; a further transition attempt is rejected).
 *
 * Isolation: operates on a FRESH fiscal year (YEAR below) generated solely for
 * this spec, never the 2026 fiscal year golden-path.spec.ts/
 * golden-path-negative.spec.ts already opened and depend on staying OPEN —
 * lock is irreversible, so reusing a shared year here would be a real risk to
 * every other suite's fixtures, not just this one's.
 *
 * Prerequisites: same as golden-path.spec.ts (see that file's header) — Tenant
 * A ADMIN fixture (already holds fiscal.period.* per the S008 auth-service
 * migration's ADMIN grants) and the CLERK fixture (deliberately lacks
 * fiscal.period.soft_close, for the negative-permission scenario).
 */
import { test, expect } from '@playwright/test';

const BASE = '/amacc';
const API = 'http://localhost:13100';
const TENANT_A = '1cf31f14-cb0b-4261-a41d-f79953594c86';
const ADMIN_EMAIL = 'admin@kunes-final-r0.test';
const CLERK_EMAIL = 'clerk@kunes-final-r0.test';
const PASSWORD = 'FinalR0-Evidence-2026!';
// Far-future year dedicated to this spec — never touched by any other suite.
const YEAR = 2099;

async function login(page: any, tenantId: string, email: string, password: string) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(tenantId);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
}

test.describe('S008 — period close/reopen/lock lifecycle', () => {
  test.setTimeout(120_000);

  test('OPEN -> soft-close -> hard-close (blocked, then unblocked) -> reopen-hard-closed -> soft-close -> hard-close -> lock (terminal)', async ({ page }) => {
    await login(page, TENANT_A, ADMIN_EMAIL, PASSWORD);
    await page.waitForURL(/\/golden-path\/select-entity/, { timeout: 15_000 });
    await expect(page.getByTestId('legal-entity-list')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('select-entity-KUNES-01').click();
    await page.waitForURL(/\/golden-path\/org-hierarchy/, { timeout: 10_000 });

    // Navigate straight to fiscal (this spec doesn't need the org-hierarchy/
    // role-template intermediate steps golden-path.spec.ts covers).
    await page.goto(`${BASE}/golden-path/fiscal`);
    await expect(page.getByTestId('fiscal-calendar-status')).toBeVisible({ timeout: 10_000 });

    // Generate this spec's own dedicated fiscal year so the periods it
    // soft-closes/hard-closes/locks are never ones another suite relies on.
    // The UI's own "generate" button always targets the CURRENT year, so a
    // specific future year is requested directly, authenticated with the same
    // token the browser session already holds (JWT lives in localStorage,
    // not cookies, per AuthContext.tsx).
    const authHeader = { 'x-tenant-id': TENANT_A };
    const token = await page.evaluate(() => localStorage.getItem('goldenpath.accessToken'));
    expect(token, 'expected a real access token in localStorage after login').toBeTruthy();

    await page.request.post(`${API}/api/v1/fiscal/entities/${await page.evaluate(() => localStorage.getItem('goldenpath.legalEntityId') ?? '')}/fiscal-calendar/years`, {
      headers: { Authorization: `Bearer ${token}`, ...authHeader, 'Content-Type': 'application/json' },
      data: { fiscalYear: YEAR },
    }).catch(() => undefined); // may already exist from a prior run of this spec — non-fatal either way

    await page.reload();
    await expect(page.getByTestId('period-board')).toBeVisible({ timeout: 10_000 });

    const periodCode = `${YEAR}-01`;
    const row = page.getByTestId(`period-row-${periodCode}`);
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Open it if still FUTURE.
    const openBtn = page.getByTestId(`open-period-${periodCode}`);
    if (await openBtn.isVisible().catch(() => false)) {
      await openBtn.click();
      await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('OPEN', { timeout: 10_000 });
    }

    // ── Soft-close ──────────────────────────────────────────────────────────
    await page.getByTestId(`soft-close-${periodCode}`).click();
    await expect(page.getByTestId('period-ceremony-panel')).toBeVisible();
    await page.getByTestId('period-ceremony-reason').fill('S008 E2E: month-end cutoff');
    await page.getByTestId('period-ceremony-submit').click();
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('SOFT_CLOSED', { timeout: 10_000 });

    // ── Hard-close blocked by an open draft (AC008-4) ────────────────────────
    // Seed a real DRAFT dated inside this period directly via the API (this
    // spec is about period control, not draft-creation UX, which
    // golden-path.spec.ts already covers step-by-step through the UI).
    const legalEntityId = await page.evaluate(() => localStorage.getItem('goldenpath.legalEntityId') ?? '');
    const accounts = await page.request.get(`${API}/api/v1/coa/accounts?entity=${legalEntityId}`, {
      headers: { Authorization: `Bearer ${token}`, ...authHeader },
    }).then((r) => r.json());
    const drAccount = accounts.accounts.find((a: any) => a.type === 'ASSET' && a.postable);
    const crAccount = accounts.accounts.find((a: any) => a.type !== 'ASSET' && a.postable && a.id !== drAccount?.id);
    expect(drAccount, 'expected at least one postable ASSET account to exist for this entity').toBeTruthy();
    expect(crAccount, 'expected a second distinct postable account to exist for this entity').toBeTruthy();

    const draftResp = await page.request.post(`${API}/api/v1/coa/manual-journals/drafts`, {
      headers: { Authorization: `Bearer ${token}`, ...authHeader, 'Content-Type': 'application/json' },
      data: {
        entityId: legalEntityId,
        entryDate: `${YEAR}-01-15`,
        sourceCode: '88',
        memo: 'S008 E2E blocking draft',
        lines: [
          { accountId: drAccount.id, storeId: accounts.accounts[0]?.storeId ?? undefined, dr: 10, cr: 0 },
          { accountId: crAccount.id, storeId: accounts.accounts[0]?.storeId ?? undefined, deptCode: '01', dr: 0, cr: 10 },
        ],
      },
    });
    const draft = await draftResp.json();

    await page.getByTestId(`hard-close-${periodCode}`).click();
    await page.getByTestId('period-ceremony-reason').fill('S008 E2E: month locked');
    await page.getByTestId('period-ceremony-submit').click();
    await expect(page.getByTestId('period-blocking-drafts')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`period-blocking-draft-${draft.draftId}`)).toBeVisible();
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('SOFT_CLOSED'); // unchanged — no transition occurred

    // Unblock: post the draft, then retry.
    await page.request.post(`${API}/api/v1/coa/manual-journals/drafts/${draft.draftId}:validate`, {
      headers: { Authorization: `Bearer ${token}`, ...authHeader },
    });
    await page.request.post(`${API}/api/v1/coa/manual-journals/drafts/${draft.draftId}:post`, {
      headers: { Authorization: `Bearer ${token}`, ...authHeader },
    });
    await page.getByTestId('period-ceremony-cancel').click();
    await page.reload();
    await page.getByTestId(`hard-close-${periodCode}`).click();
    await page.getByTestId('period-ceremony-reason').fill('S008 E2E: month locked, drafts cleared');
    await page.getByTestId('period-ceremony-submit').click();
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('HARD_CLOSED', { timeout: 10_000 });

    // ── Reopen-hard-closed: two-step confirm, ADMIN-only tier ────────────────
    await page.getByTestId(`reopen-hard-closed-${periodCode}`).click();
    await page.getByTestId('period-ceremony-reason').fill('S008 E2E: audit request');
    await page.getByTestId('period-ceremony-submit').click();
    await expect(page.getByTestId('period-ceremony-confirm')).toBeVisible({ timeout: 10_000 }); // pending confirmation, no transition yet
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('HARD_CLOSED');
    await page.getByTestId('period-ceremony-confirm').click();
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('OPEN', { timeout: 10_000 });

    // ── Back through the cycle to LOCKED ──────────────────────────────────────
    await page.getByTestId(`soft-close-${periodCode}`).click();
    await page.getByTestId('period-ceremony-reason').fill('S008 E2E: second cutoff');
    await page.getByTestId('period-ceremony-submit').click();
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('SOFT_CLOSED', { timeout: 10_000 });

    await page.getByTestId(`hard-close-${periodCode}`).click();
    await page.getByTestId('period-ceremony-reason').fill('S008 E2E: second lock');
    await page.getByTestId('period-ceremony-submit').click();
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('HARD_CLOSED', { timeout: 10_000 });

    await page.getByTestId(`lock-${periodCode}`).click();
    await expect(page.getByText(/PERMANENT and IRREVERSIBLE/)).toBeVisible();
    await page.getByTestId('period-ceremony-reason').fill('S008 E2E: year sealed');
    await page.getByTestId('period-ceremony-submit').click();
    await expect(page.getByTestId('period-ceremony-confirm')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('HARD_CLOSED'); // still unchanged pre-confirm
    await page.getByTestId('period-ceremony-confirm').click();
    await expect(page.getByTestId(`period-status-${periodCode}`)).toHaveText('LOCKED', { timeout: 10_000 });

    // ── LOCKED is terminal: no action buttons, further transitions rejected ──
    await page.reload();
    await expect(page.getByTestId(`period-terminal-${periodCode}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(`[data-testid="soft-close-${periodCode}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="hard-close-${periodCode}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="reopen-${periodCode}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="reopen-hard-closed-${periodCode}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-testid="lock-${periodCode}"]`)).toHaveCount(0);

    // Direct API confirmation that even a bypass-the-UI attempt is rejected:
    // LOCKED is terminal at the DB trigger, not merely hidden by the UI.
    const board = await page.request.get(`${API}/api/v1/fiscal/periods?entity=${legalEntityId}`, {
      headers: { Authorization: `Bearer ${token}`, ...authHeader },
    }).then((r) => r.json());
    const lockedPeriod = board.board.find((p: any) => p.periodCode === periodCode);
    expect(lockedPeriod?.status).toBe('LOCKED');
    const bypassResp = await page.request.post(`${API}/api/v1/fiscal/periods/${lockedPeriod.periodId}/reopen-hard-closed`, {
      headers: { Authorization: `Bearer ${token}`, ...authHeader, 'Content-Type': 'application/json' },
      data: { reason: 'should be rejected', confirm: true },
    });
    expect(bypassResp.status()).toBe(422);
    const bypassBody = await bypassResp.json();
    expect(bypassBody.error).toBe('PERIOD_LOCKED_TERMINAL');
  });
});

test.describe('S008 — negative: unauthorized soft-close (real least-privilege 403)', () => {
  test('CLERK role is denied fiscal.period.soft_close at the API (through the gateway)', async ({ page }) => {
    await login(page, TENANT_A, CLERK_EMAIL, PASSWORD);
    // CLERK is denied earlier in the Golden Path (acct.entity.view) per
    // golden-path-negative.spec.ts's own finding, so this scenario is proven
    // directly against the gateway rather than by driving the CLERK session
    // through every intermediate screen it cannot reach.
    const loginResp = await page.request.post(`http://localhost:13100/api/v1/auth/login`, {
      data: { tenantId: TENANT_A, email: CLERK_EMAIL, password: PASSWORD },
    });
    const { accessToken } = await loginResp.json();
    const resp = await page.request.post(`http://localhost:13100/api/v1/fiscal/periods/00000000-0000-0000-0000-000000000000/soft-close`, {
      headers: { Authorization: `Bearer ${accessToken}`, 'x-tenant-id': TENANT_A, 'Content-Type': 'application/json' },
      data: { reason: 'should be denied' },
    });
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(String(body.message ?? body.error)).toMatch(/permission|soft_close/i);
  });
});

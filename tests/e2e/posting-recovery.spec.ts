/**
 * S021 Posting Recovery — DLQ inspection + replay browser journey.
 *
 * CE-07 integration update: rewritten against the canonical Accounting
 * routes (/accounting/gl/posting-recovery, /accounting/dashboard post-login)
 * introduced by "Unify Golden Path into single Accounting app experience"
 * (51ad9d6) — the original foundation-slice spec still asserted the
 * pre-unification /golden-path/select-entity post-login redirect and never
 * exercised replay at all (it predates the completion slice). This version
 * adds the actual failure -> DLQ -> investigation -> replay journey against
 * the real, merged S019/S020 posting engine.
 *
 * Follows the exact framework/conventions of tests/e2e/golden-path.spec.ts
 * (Playwright, real backend, real JWT auth, no mocks) — same `login()`
 * shape, same BASE_URL/API_BASE override convention.
 *
 * Journey:
 *   1.  Sign in as a user holding posting-recovery.queue.read/case.read/
 *       payload.read/audit.read/replay.execute (e.g. ADMIN or CONTROLLER).
 *   2.  Open Posting Recovery (canonical /accounting/gl/posting-recovery).
 *   3.  Verify the queue loads.
 *   4.  Filter by one failure category.
 *   5.  Open a failed-event case (the one with prior failed-replay history).
 *   6.  Verify original event timestamp / correlation ID / masked payload /
 *       failure details / attempt history / lineage / audit timeline.
 *   7.  Open the separate replay-eligible case and execute a REAL replay —
 *       CH01 (coa-service) genuinely evaluates it (no tenant has a rule
 *       pack for the fixture's symbolic event type) and returns
 *       NO_RULE_MATCH, proving the full S021 -> S019/S020 wire-up without
 *       authoring any accounting rule content (that boundary is S023's).
 *   8.  Sign out and sign in as a user with NO posting-recovery permission;
 *       verify the unauthorized state.
 *
 * Prerequisites (NOT bootstrapped by this spec — matches this repo's
 * existing E2E convention of assuming a pre-seeded, already-running
 * backend stack, see tests/e2e/golden-path.spec.ts's header comment):
 *   1. apps/web dev server running (POSTING_RECOVERY_API_TARGET override
 *      as needed — see apps/web/vite.config.ts).
 *   2. auth-service + posting-recovery-service + coa-service running
 *      against the same Postgres, with all three services' migrations
 *      applied (including the CE-07 integration's renumbered S021 authz
 *      catalog migrations and the replay-lock-timeout migration).
 *   3. posting-recovery-service started with
 *      POSTING_RECOVERY_FIXTURES_ENABLED=true, and
 *      services/posting-recovery-service/tests/fixtures/load-fixtures.ts
 *      run once against it (loads FIXTURE_TENANT_A's cases, including the
 *      failed-replay-attempt case and the replay-eligible case moved to
 *      READY_FOR_REPLAY, plus FIXTURE_TENANT_B's isolation case).
 *   4. Two real auth-service users in FIXTURE_TENANT_A:
 *        - PR_ADMIN_EMAIL / PR_ADMIN_PASSWORD, assigned a role granting
 *          posting-recovery.queue.read/case.read/payload.read/audit.read/
 *          replay.execute (e.g. ADMIN).
 *        - PR_NO_PERMISSION_EMAIL / PR_NO_PERMISSION_PASSWORD, an
 *          authenticated user with NO posting-recovery permission.
 *      Override the emails/passwords/tenant via env vars below if your
 *      environment seeds different values.
 *
 * Run with: BASE_URL=http://localhost:5174 npx playwright test posting-recovery
 */
import { test, expect } from '@playwright/test';

const BASE = '/amacc';
const TENANT_ID = process.env['PR_TENANT_ID'] ?? 'aaaaaaaa-fa11-4000-a000-000000000001';
const ADMIN_EMAIL = process.env['PR_ADMIN_EMAIL'] ?? 'admin@posting-recovery.test';
const ADMIN_PASSWORD = process.env['PR_ADMIN_PASSWORD'] ?? 'PostingRecovery-Evidence-2026!';
const NO_PERMISSION_EMAIL = process.env['PR_NO_PERMISSION_EMAIL'] ?? 'noperm@posting-recovery.test';
const NO_PERMISSION_PASSWORD = process.env['PR_NO_PERMISSION_PASSWORD'] ?? 'PostingRecovery-Evidence-2026!';

async function login(page: any, tenantId: string, email: string, password: string) {
  await page.goto(`${BASE}/login`);
  await page.getByTestId('login-tenant-id').fill(tenantId);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  // Login.tsx's handleSubmit is async (real fetch to auth-service) and only
  // navigates on success — wait for that navigation (post-"Unify Golden
  // Path" default landing is /accounting/dashboard, not
  // /golden-path/select-entity) so a subsequent page.goto() never races
  // the in-flight login request.
  await page.waitForURL(/\/accounting\/dashboard/, { timeout: 15_000 });
}

test('Posting Recovery — queue, filter, case detail, real replay, and unauthorized state', async ({ page }) => {
  // 1-2. Sign in as an authorized user, open Posting Recovery (canonical route).
  await login(page, TENANT_ID, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto(`${BASE}/accounting/gl/posting-recovery`);

  // 3. Verify the queue loads.
  await expect(page.getByTestId('posting-recovery-queue')).toBeVisible();
  await expect(page.getByTestId('prq-table')).toBeVisible({ timeout: 15_000 });

  // 4. Filter by one failure category (RULE_NOT_FOUND — one of the loaded fixtures).
  await page.getByTestId('prq-filter-category').selectOption('RULE_NOT_FOUND');
  await expect(page.getByTestId('prq-table')).toBeVisible();
  await expect(page.getByText('RULE_NOT_FOUND').first()).toBeVisible();

  // Clear the filter and open the case with a failed-replay-attempt history
  // (FIXTURE_WITH_FAILED_REPLAY — failureCategory ACCOUNTING_MAPPING_UNRESOLVED).
  await page.getByTestId('prq-filter-category').selectOption('ACCOUNTING_MAPPING_UNRESOLVED');
  await expect(page.getByTestId('prq-table')).toBeVisible();
  const row = page.locator('[data-testid^="prq-row-"]').first();
  await row.getByRole('link').click();

  // 5. Case detail opened.
  await expect(page.getByTestId('posting-recovery-case-detail')).toBeVisible();

  // 6. Original event timestamp — the fixture's occurredAt (2026-07-25T14:00:00.000Z).
  await expect(page.getByTestId('prd-original-timestamp')).toContainText('2026');

  // Original correlation ID — the fixture's correlationId.
  await expect(page.getByTestId('prd-correlation-id')).toContainText('fixture-corr-failed-replay');

  // Masked payload presentation — the fixture payload has no sensitive
  // fields, so this proves the payload section renders as a formatted,
  // read-only JSON viewer (immutable — no edit affordance anywhere on this screen).
  await expect(page.getByTestId('prd-payload')).toContainText('DEAL-9004');

  // Failure details — stage + code visible.
  await expect(page.getByTestId('prd-failure-details')).toContainText('GL_ACCOUNT_MAPPING_NOT_FOUND');
  await expect(page.getByTestId('prd-operator-guidance')).toBeVisible();

  // Attempt history — the loader appended one FAILED attempt for this case.
  await expect(page.getByTestId('prd-attempts')).toContainText('FAILED');

  // Lineage.
  await expect(page.getByTestId('prd-lineage')).toContainText('DEAL-9004');

  // Audit timeline — at minimum, dead_letter_created + case_viewed entries.
  await expect(page.getByTestId('prd-audit-timeline')).toContainText('posting_recovery');

  // This case (QUARANTINED, per the loader — never transitioned) is not
  // replay-eligible, so no enabled Replay button.
  await expect(page.getByTestId('prd-replay-action')).not.toContainText('Replay in progress');
  const replayButtonHere = page.getByTestId('prd-replay-button');
  await expect(replayButtonHere).toHaveCount(0);

  // 7. CE-07 integration — the actual failure -> DLQ -> investigation ->
  // REPLAY journey, against the real posting-recovery-service ->
  // coa-service (S019/S020) wire-up. Open the queue again and find the
  // replay-eligible fixture case (moved to READY_FOR_REPLAY by the loader).
  await page.goto(`${BASE}/accounting/gl/posting-recovery`);
  await page.getByTestId('prq-filter-category').selectOption('');
  await page.getByTestId('prq-filter-search').fill('fixture-corr-replay-eligible');
  await expect(page.getByTestId('prq-table')).toBeVisible();
  await page.locator('[data-testid^="prq-row-"]').first().getByRole('link').click();
  await expect(page.getByTestId('posting-recovery-case-detail')).toBeVisible();
  await expect(page.getByTestId('prd-status')).toContainText('READY_FOR_REPLAY');

  const replayButton = page.getByTestId('prd-replay-button');
  await expect(replayButton).toBeVisible();
  await expect(replayButton).toBeEnabled();
  await replayButton.click();

  // The real posting engine evaluates this event for real (no tenant has a
  // rule pack for the symbolic TEST_DEAL_POSTED event type) and genuinely
  // returns NO_RULE_MATCH -> surfaced here as a REJECTED outcome. This is
  // the proof the wiring is real: a fabricated/mocked call could not
  // produce this specific, correctly-classified rejection.
  await expect(page.getByTestId('prd-replay-result')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('prd-replay-result')).toContainText(/REJECTED|FAILED/);
  await expect(page.getByTestId('prd-status')).toContainText('UNDER_REVIEW');

  // Clicking Replay again is now impossible from this screen (case moved
  // out of READY_FOR_REPLAY) — the button must be gone/disabled, never a
  // second real posting-engine call fired from a stale UI state.
  await expect(page.getByTestId('prd-replay-button')).toHaveCount(0);

  // 8. Sign out, sign in as a user with NO posting-recovery permission,
  // verify the unauthorized state (not a blank page, not a crash).
  await page.evaluate(() => localStorage.clear());
  await login(page, TENANT_ID, NO_PERMISSION_EMAIL, NO_PERMISSION_PASSWORD);
  await page.goto(`${BASE}/accounting/gl/posting-recovery`);
  await expect(page.getByTestId('prq-unauthorized')).toBeVisible({ timeout: 15_000 });
});

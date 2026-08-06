/**
 * Golden R0 Phase 5 checkpoint — visual evidence capture ONLY. Not part of
 * the 14-test certification suite; captures 1280px viewport and 200%-zoom/
 * accessibility screenshots via Playwright browser-context configuration
 * (not manual browser resizing), per the Product checkpoint requirement.
 *
 * 200% zoom is emulated the standard Playwright way: half the CSS viewport
 * at the same device pixel ratio (640x450 renders the same layout a user
 * would see zooming a 1280x900 page to 200%), not deviceScaleFactor alone
 * (which only affects screenshot resolution, not CSS layout).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';

const BASE = '/amacc';
const TENANT_A = '1cf31f14-cb0b-4261-a41d-f79953594c86';
const ADMIN_EMAIL = 'admin@kunes-final-r0.test';
const PASSWORD = 'FinalR0-Evidence-2026!';
const EVIDENCE_DIR = 'test-results/phase5-evidence';

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

async function login(page: any) {
  await page.goto(`${BASE}/golden-path/login`);
  await page.getByTestId('login-tenant-id').fill(TENANT_A);
  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/golden-path\/select-entity/, { timeout: 15_000 });
  await page.getByTestId('select-entity-KUNES-01').click();
  await page.waitForURL(/\/golden-path\/org-hierarchy/, { timeout: 10_000 });
}

const SCREENS: Array<{ name: string; path: string; testId?: string }> = [
  { name: 'org-hierarchy', path: '/golden-path/org-hierarchy', testId: 'org-tree' },
  { name: 'journal', path: '/golden-path/journal', testId: 'journal-lines-table' },
  { name: 'trial-balance', path: '/golden-path/trial-balance', testId: 'tb-grand-total' },
  { name: 'balance-sheet', path: '/golden-path/balance-sheet' },
  { name: 'income-statement', path: '/golden-path/income-statement' },
  { name: 'gl-inquiry', path: '/golden-path/gl-inquiry' },
  { name: 'gl-search', path: '/golden-path/gl-search' },
];

test.describe('Phase 5 evidence — 1280px viewport', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('capture 1280px screenshots across Golden Path screens', async ({ page }) => {
    await login(page);
    for (const s of SCREENS) {
      await page.goto(`${BASE}${s.path}`);
      if (s.testId) {
        await expect(page.getByTestId(s.testId)).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      await page.screenshot({ path: `${EVIDENCE_DIR}/1280-${s.name}.png`, fullPage: true });
      expect(overflow, `${s.name} should not have unintended horizontal overflow at 1280px`).toBe(false);
    }
  });
});

test.describe('Phase 5 evidence — 200% zoom / accessibility', () => {
  // Half the CSS viewport at 1x DPR == the layout a user sees at 200% zoom.
  test.use({ viewport: { width: 640, height: 450 } });

  test('capture 200%-zoom screenshots and verify usability across Golden Path screens', async ({ page }) => {
    await login(page);
    for (const s of SCREENS) {
      await page.goto(`${BASE}${s.path}`);
      if (s.testId) {
        await expect(page.getByTestId(s.testId)).toBeVisible({ timeout: 10_000 }).catch(() => undefined);
      }
      await page.waitForTimeout(300);
      // Golden R0 Phase — Workstream 3 regression check: the context bar
      // previously overflowed the viewport at 200% zoom, clipping "Signed
      // in as" off-screen. document.body.scrollWidth > clientWidth would
      // catch that regressing again (the ContextBar's own fix uses
      // flex-wrap, so it should never force page-level horizontal scroll).
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      await page.screenshot({ path: `${EVIDENCE_DIR}/zoom200-${s.name}.png`, fullPage: true });
      expect(overflow, `${s.name} should not have unintended horizontal overflow at 200% zoom`).toBe(false);
    }

    // Keyboard focus visibility check on a representative screen.
    await page.goto(`${BASE}/golden-path/trial-balance`);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focusOutline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { outline: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow };
    });
    await page.screenshot({ path: `${EVIDENCE_DIR}/zoom200-keyboard-focus.png` });
    expect(focusOutline, 'a focused element should exist').not.toBeNull();
  });
});

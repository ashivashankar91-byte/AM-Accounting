import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    // FINAL-R0 defect fix: apps/web's vite.config.ts runs the dev server on
    // port 5174 (5173 is used by a different app in this monorepo), so the
    // previous 5173 default here silently pointed every spec at nothing.
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // The frontend dev server must be running separately (npm run dev in apps/web)
  // To run: npx playwright test
});

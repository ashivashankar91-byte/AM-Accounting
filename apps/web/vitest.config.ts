import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// First frontend unit-test setup in apps/web (S019/S020) — the rest of the
// monorepo's Playwright e2e suite (tests/e2e/*.spec.ts) covers full-stack
// browser journeys; this config is for fast, no-backend component tests of
// loading/empty/error/unauthorized/forbidden/success screen states.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});

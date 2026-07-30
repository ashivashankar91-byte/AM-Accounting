import { defineConfig } from 'vitest/config';
import path from 'path';

// Mirrors coa-service/vitest.config.ts — the dot-prefixed generated Prisma
// client package (.prisma/cash-client) isn't resolved by vitest/Vite's
// resolver the way plain Node module resolution handles it. Only
// tests/live-db/*.test.ts needs the real client; every other test mocks
// Prisma and never resolves this specifier.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/cash-client': path.resolve(__dirname, 'node_modules/.prisma/cash-client/index.js'),
    },
  },
});

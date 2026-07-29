import { defineConfig } from 'vitest/config';
import path from 'path';

// S003 P1 corrective pass: vitest/Vite's resolver does not resolve the
// dot-prefixed generated Prisma client package (.prisma/tenant-client) the
// way plain Node module resolution does — every pre-existing test file
// avoided this by mocking Prisma entirely rather than importing the real
// client. tests/live-db/*.test.ts is the first to need the real client for
// a live database, so it needs an explicit alias; this has no effect on
// any other test file (they never resolve this specifier). Mirrors the
// identical fix already applied in services/coa-service/vitest.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/tenant-client': path.resolve(__dirname, 'node_modules/.prisma/tenant-client/index.js'),
    },
  },
});

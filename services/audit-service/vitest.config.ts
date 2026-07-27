import { defineConfig } from 'vitest/config';
import path from 'path';

// Same fix as services/coa-service/vitest.config.ts: vitest/Vite's resolver
// does not resolve the dot-prefixed generated Prisma client package
// (.prisma/audit-client) the way plain Node module resolution does — every
// pre-existing audit-service test file avoided this by mocking Prisma
// entirely. tests/live-db/*.test.ts is the first to need the real client
// for a live database, so it needs an explicit alias.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/audit-client': path.resolve(__dirname, 'node_modules/.prisma/audit-client/index.js'),
    },
  },
});

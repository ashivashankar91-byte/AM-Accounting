import { defineConfig } from 'vitest/config';
import path from 'path';

// Mirrors cash-service/coa-service's vitest.config.ts — the dot-prefixed
// generated Prisma client package (.prisma/recon-client) isn't resolved by
// vitest/Vite's resolver the way plain Node module resolution handles it.
// Only tests/live-db/*.test.ts needs the real client; every other test
// mocks Prisma via tests/support/fake-prisma.ts and never resolves this
// specifier.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/recon-client': path.resolve(__dirname, 'node_modules/.prisma/recon-client/index.js'),
    },
  },
});

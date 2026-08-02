import { defineConfig } from 'vitest/config';
import path from 'path';

// Mirrors services/posting-recovery-service/vitest.config.ts: vitest/Vite's
// resolver does not resolve the dot-prefixed generated Prisma client
// package the way plain Node module resolution does, so the live-db suite
// (the only one that imports the real client rather than mocking Prisma)
// needs an explicit alias.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/fixedops-client': path.resolve(__dirname, 'node_modules/.prisma/fixedops-client/index.js'),
    },
  },
});

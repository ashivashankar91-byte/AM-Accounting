import { defineConfig } from 'vitest/config';
import path from 'path';

// Mirrors services/tax-service / services/posting-recovery-service:
// vitest/Vite's resolver does not resolve the dot-prefixed generated Prisma
// client package (.prisma/floorplan-client) the way plain Node module
// resolution does, so the live-db suite (the only one that imports the real
// client rather than mocking Prisma) needs an explicit alias.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/floorplan-client': path.resolve(__dirname, 'node_modules/.prisma/floorplan-client/index.js'),
    },
  },
});

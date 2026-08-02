import { defineConfig } from 'vitest/config';
import path from 'path';

// Same pattern as coa-service/schedule-service: vitest/Vite's resolver does
// not resolve the dot-prefixed generated Prisma client package
// (.prisma/deal-accounting-client) the way plain Node module resolution does.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/deal-accounting-client': path.resolve(__dirname, 'node_modules/.prisma/deal-accounting-client/index.js'),
    },
  },
});

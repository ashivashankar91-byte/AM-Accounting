import { defineConfig } from 'vitest/config';
import path from 'path';

// Same pattern as coa-service/schedule-service: vitest/Vite's resolver does
// not resolve the dot-prefixed generated Prisma client package
// (.prisma/fni-reserve-client) the way plain Node module resolution does.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/fni-reserve-client': path.resolve(__dirname, 'node_modules/.prisma/fni-reserve-client/index.js'),
    },
  },
});

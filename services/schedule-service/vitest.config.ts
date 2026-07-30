import { defineConfig } from 'vitest/config';
import path from 'path';

// Same pattern as coa-service/gl-service: vitest/Vite's resolver does not
// resolve the dot-prefixed generated Prisma client package
// (.prisma/schedule-client) the way plain Node module resolution does.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/schedule-client': path.resolve(__dirname, 'node_modules/.prisma/schedule-client/index.js'),
    },
  },
});

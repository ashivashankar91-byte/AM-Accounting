import { defineConfig } from 'vitest/config';
import path from 'path';

// Same pattern as tax-service/schedule-service: vitest/Vite's resolver does
// not resolve the dot-prefixed generated Prisma client package
// (.prisma/oem-client) the way plain Node module resolution does.
export default defineConfig({
  resolve: {
    alias: {
      '.prisma/oem-client': path.resolve(__dirname, 'node_modules/.prisma/oem-client/index.js'),
    },
  },
  test: {
    // Several application tests share the fixed 'FIXTURE_TENANT' tenant id
    // (matching src/infrastructure/fixture-sources.ts's hardcoded fixture
    // data) against the same real certification database — disable
    // cross-file parallelism so they never race each other.
    fileParallelism: false,
  },
});

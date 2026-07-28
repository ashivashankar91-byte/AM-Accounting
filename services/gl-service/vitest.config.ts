import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '.prisma/gl-client': path.resolve(__dirname, 'node_modules/.prisma/gl-client/index.js'),
    },
  },
});

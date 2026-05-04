import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '.prisma/fs-client': path.resolve(__dirname, 'node_modules/.prisma/fs-client/index.js'),
    },
  },
  test: {
    include: ['src/tests/test-*.ts', 'src/**/*.{test,spec}.ts'],
    setupFiles: ['reflect-metadata'],
  },
});

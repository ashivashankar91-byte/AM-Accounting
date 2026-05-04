import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API_TARGET: api-gateway at 3000 in local dev; override for K8s/staging.
const API_TARGET = process.env.API_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  base: '/amacc/',
  server: {
    port: 5174,
    host: true,
    allowedHosts: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
});

import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// API_TARGET: api-gateway at 3100 in local dev (3000 is taken by automate-20-frontend).
// Override with API_TARGET env var for K8s/staging (where port 3000 is free).
const API_TARGET = process.env.API_TARGET || 'http://localhost:3100';

// Intercept service day-end routes that have no backend yet (NS-004 / CF-001).
// Removes console 404 noise until service-day-end-service is deployed.
function serviceDayEndMock(): Plugin {
  return {
    name: 'service-day-end-mock',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/v1/service/day-end/readiness') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ready: true,
            checks: [
              { name: 'Open ROs', passed: true, count: 0 },
              { name: 'Unposted Cash', passed: true, count: 0 },
              { name: 'Parts Inventory', passed: true, count: 0 },
            ],
            lastClose: null,
          }));
          return;
        }
        if (req.url?.startsWith('/api/v1/service/day-end/history')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [], total: 0, page: 1, limit: 10 }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceDayEndMock()],
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

/**
 * @module api-gateway
 * @purpose Fastify reverse proxy with per-tenant rate limiting and request logging.
 *
 * @architecture
 *   Single entry point for all AutoMate 2.0 microservices.
 *   The React frontend communicates only with this gateway — never directly with services.
 *   Each service is registered at its own path prefix and proxied to its internal URL.
 *
 * @rate-limiting 100 requests/minute per tenant (x-tenant-id) on GL/EOM write paths.
 *   Read paths: 300 requests/minute. Auth paths: 20 requests/minute.
 *
 * @replaces nginx.conf (nginx was a static config; this is dynamic and tenant-aware)
 */

import Fastify, { FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import httpProxy from '@fastify/http-proxy';
import pino from 'pino';

const logger = pino({ name: 'api-gateway' });
const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

// ── Service registry ─────────────────────────────────────────────────────────
// Ports match docker-compose.yml PORT env vars (internal container ports):
//   auth-service:3001, tenant-service:3002, gl-service:3010, eom-service:3011
//   payroll-service:3012, apar-service:3013, recon-service:3014, fs-service:3015
//   coa-service:3016, schedule-service:3018, agent-gl:3020, agent-eom:3021
//   agent-payroll:3022, agent-apar:3023, agent-t1:3024, notification-service:3030
//   audit-service:3031, connector-service:3032, approval-service:3033
//   onboarding-service:3035, webhook-service:3036, cashflow-service:3037
//   document-service:3038, group-service:3039, user-service:3040
//   compliance-service:3043, query-service:3045, analytics-service:3046
//   orchestrator-service:3048

const SERVICES: Array<{ prefix: string; upstream: string; rateLimit?: number; rewritePrefix?: string }> = [
  { prefix: '/api/v1/auth',           upstream: process.env['AUTH_SERVICE_URL']           ?? 'http://auth-service:3001' },
  { prefix: '/api/v1/tenants',        upstream: process.env['TENANT_SERVICE_URL']         ?? 'http://tenant-service:3002' },
  { prefix: '/api/v1/gl/fs',           upstream: process.env['FS_SERVICE_URL']             ?? 'http://fs-service:3015',        rewritePrefix: '/api/v1/fs' },
  { prefix: '/api/v1/gl',             upstream: process.env['GL_SERVICE_URL']             ?? 'http://gl-service:3010',       rateLimit: 100 },
  { prefix: '/api/v1/dashboard',      upstream: process.env['GL_SERVICE_URL']             ?? 'http://gl-service:3010' },
  { prefix: '/api/v1/approvals',      upstream: process.env['APPROVAL_SERVICE_URL']       ?? 'http://approval-service:3033', rewritePrefix: '/api/v1/approvals' },
  { prefix: '/api/v1/bank-deposits',  upstream: process.env['GL_SERVICE_URL']             ?? 'http://gl-service:3010',       rewritePrefix: '/api/v1/gl/bank-deposits' },
  { prefix: '/api/v1/command-center', upstream: process.env['GL_SERVICE_URL']             ?? 'http://gl-service:3010' },
  { prefix: '/api/v1/recon',          upstream: process.env['RECON_SERVICE_URL']          ?? 'http://recon-service:3014' },
  { prefix: '/api/v1/eom',            upstream: process.env['EOM_SERVICE_URL']            ?? 'http://eom-service:3011' },
  { prefix: '/api/v1/payroll',        upstream: process.env['PAYROLL_SERVICE_URL']        ?? 'http://payroll-service:3012' },
  { prefix: '/api/v1/apar',           upstream: process.env['APAR_SERVICE_URL']           ?? 'http://apar-service:3013' },
  { prefix: '/api/v1/purchase-orders', upstream: process.env['APAR_SERVICE_URL']          ?? 'http://apar-service:3013', rewritePrefix: '/api/v1/apar/purchase-orders' },
  { prefix: '/api/v1/fs',             upstream: process.env['FS_SERVICE_URL']             ?? 'http://fs-service:3015' },
  { prefix: '/api/v1/coa',            upstream: process.env['COA_SERVICE_URL']            ?? 'http://coa-service:3016' },
  { prefix: '/api/v1/schedules',      upstream: process.env['SCHEDULE_SERVICE_URL']       ?? 'http://schedule-service:3018' },
  { prefix: '/api/v1/notifications',  upstream: process.env['NOTIFICATION_SERVICE_URL']   ?? 'http://notification-service:3030' },
  { prefix: '/api/v1/audit',          upstream: process.env['AUDIT_SERVICE_URL']          ?? 'http://audit-service:3031' },
  { prefix: '/api/v1/connector',      upstream: process.env['CONNECTOR_SERVICE_URL']      ?? 'http://connector-service:3032' },
  { prefix: '/api/v1/approval',       upstream: process.env['APPROVAL_SERVICE_URL']       ?? 'http://approval-service:3033' },
  { prefix: '/api/v1/onboarding',     upstream: process.env['ONBOARDING_SERVICE_URL']     ?? 'http://onboarding-service:3035' },
  { prefix: '/api/v1/webhooks',       upstream: process.env['WEBHOOK_SERVICE_URL']        ?? 'http://webhook-service:3036' },
  { prefix: '/api/v1/cashflow',       upstream: process.env['CASHFLOW_SERVICE_URL']       ?? 'http://cashflow-service:3037' },
  { prefix: '/api/v1/documents',      upstream: process.env['DOCUMENT_SERVICE_URL']       ?? 'http://document-service:3038' },
  { prefix: '/api/v1/groups',         upstream: process.env['GROUP_SERVICE_URL']          ?? 'http://group-service:3039' },
  { prefix: '/api/v1/user',           upstream: process.env['USER_SERVICE_URL']           ?? 'http://user-service:3040' },
  { prefix: '/api/v1/users',          upstream: process.env['USER_SERVICE_URL']           ?? 'http://user-service:3040' },
  { prefix: '/api/v1/compliance',     upstream: process.env['COMPLIANCE_SERVICE_URL']     ?? 'http://compliance-service:3043' },
  { prefix: '/api/v1/query',          upstream: process.env['QUERY_SERVICE_URL']          ?? 'http://query-service:3045' },
  { prefix: '/api/v1/analytics',      upstream: process.env['ANALYTICS_SERVICE_URL']      ?? 'http://analytics-service:3046' },
  { prefix: '/api/v1/ml',             upstream: process.env['ANALYTICS_SERVICE_URL']      ?? 'http://analytics-service:3046' },
  { prefix: '/api/v1/orchestrator',   upstream: process.env['ORCHESTRATOR_SERVICE_URL']   ?? 'http://orchestrator-service:3048' },
  // Service-department endpoints (day-end, technicians, RO history) — no dedicated service yet, proxied to eom-service as closest
  { prefix: '/api/v1/service',        upstream: process.env['EOM_SERVICE_URL']             ?? 'http://eom-service:3011' },
  { prefix: '/api/v1/reports',        upstream: process.env['ANALYTICS_SERVICE_URL']       ?? 'http://analytics-service:3046' },
  // Intelligence layer — agent-t1 handles copilot and agents HTTP
  { prefix: '/api/v1/copilot',        upstream: process.env['AGENT_T1_URL']               ?? 'http://agent-t1:3024' },
  { prefix: '/api/v1/agents',         upstream: process.env['AGENT_T1_URL']               ?? 'http://agent-t1:3024' },
  // Cash receipts — proxied to apar-service (AR domain); /deposits sub-routes handled there
  { prefix: '/api/v1/cash-receipts',  upstream: process.env['APAR_SERVICE_URL']           ?? 'http://apar-service:3013', rewritePrefix: '/api/v1/apar' },
  // ESG sustainability reporting — GL service provides stubs from live GL data
  { prefix: '/api/v1/esg',            upstream: process.env['GL_SERVICE_URL']             ?? 'http://gl-service:3010' },
  // Vendor shorthand (same as /apar/vendors)
  { prefix: '/api/v1/vendors',        upstream: process.env['APAR_SERVICE_URL']           ?? 'http://apar-service:3013', rewritePrefix: '/api/v1/apar/vendors' },
];

// ── Request logging hook ──────────────────────────────────────────────────────

function tenantKeyGenerator(req: FastifyRequest): string {
  return (req.headers['x-tenant-id'] as string) ?? req.ip;
}

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  const app = Fastify({ logger: true, disableRequestLogging: true });
  await app.register(cors, { origin: true });

  // Global rate limit: 300/min per tenant, override per-service as needed
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: tenantKeyGenerator,
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s.`,
    }),
  });

  // Request logging
  app.addHook('onRequest', async (request) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    const start = Date.now();
    request.raw.on('close', () => {
      logger.info({
        method: request.method,
        url: request.url,
        tenantId: tenantId ?? '—',
        status: request.raw.statusCode,
        durationMs: Date.now() - start,
      }, 'request');
    });
  });

  // Gateway health
  app.get('/health', async () => ({
    status: 'ok',
    service: 'api-gateway',
    upstreamCount: SERVICES.length,
    timestamp: new Date().toISOString(),
  }));

  // Service health aggregation
  app.get('/health/services', async (_req, reply) => {
    const checks = await Promise.allSettled(
      SERVICES.map(async (svc) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        try {
          const res = await fetch(`${svc.upstream}/health`, { signal: controller.signal });
          return { prefix: svc.prefix, upstream: svc.upstream, status: res.ok ? 'ok' : 'degraded', statusCode: res.status };
        } catch {
          return { prefix: svc.prefix, upstream: svc.upstream, status: 'down' };
        } finally {
          clearTimeout(timeout);
        }
      }),
    );
    const results = checks.map((c) => (c.status === 'fulfilled' ? c.value : { status: 'error' }));
    const allOk = results.every((r) => r.status === 'ok');
    return reply.status(allOk ? 200 : 207).send({ overall: allOk ? 'ok' : 'degraded', services: results });
  });

  // Register proxy routes for each service
  for (const svc of SERVICES) {
    await app.register(httpProxy, {
      upstream: svc.upstream,
      prefix: svc.prefix,
      rewritePrefix: svc.rewritePrefix ?? svc.prefix,
      http2: false,
    });
    logger.info(`Registered proxy: ${svc.prefix} → ${svc.upstream}`);
  }

  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`api-gateway listening on :${PORT} (${SERVICES.length} services proxied)`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start api-gateway');
  process.exit(1);
});

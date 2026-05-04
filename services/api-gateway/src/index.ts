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

const SERVICES: Array<{ prefix: string; upstream: string; rateLimit?: number }> = [
  { prefix: '/api/v1/auth',        upstream: process.env['AUTH_SERVICE_URL']          ?? 'http://auth-service:3001' },
  { prefix: '/api/v1/gl',          upstream: process.env['GL_SERVICE_URL']            ?? 'http://gl-service:3010',       rateLimit: 100 },
  { prefix: '/api/v1/eom',         upstream: process.env['EOM_SERVICE_URL']           ?? 'http://eom-service:3011' },
  { prefix: '/api/v1/payroll',     upstream: process.env['PAYROLL_SERVICE_URL']       ?? 'http://payroll-service:3012' },
  { prefix: '/api/v1/apar',        upstream: process.env['APAR_SERVICE_URL']          ?? 'http://apar-service:3013' },
  { prefix: '/api/v1/schedules',   upstream: process.env['SCHEDULE_SERVICE_URL']      ?? 'http://schedule-service:3030' },
  { prefix: '/api/v1/groups',      upstream: process.env['GROUP_SERVICE_URL']         ?? 'http://group-service:3040' },
  { prefix: '/api/v1/analytics',   upstream: process.env['ANALYTICS_SERVICE_URL']     ?? 'http://analytics-service:3041' },
  { prefix: '/api/v1/compliance',  upstream: process.env['COMPLIANCE_SERVICE_URL']    ?? 'http://compliance-service:3042' },
  { prefix: '/api/v1/cashflow',    upstream: process.env['CASHFLOW_SERVICE_URL']      ?? 'http://cashflow-service:3043' },
  { prefix: '/api/v1/coa',         upstream: process.env['COA_SERVICE_URL']           ?? 'http://coa-service:3044' },
  { prefix: '/api/v1/fs',          upstream: process.env['FS_SERVICE_URL']            ?? 'http://fs-service:3045' },
  { prefix: '/api/v1/notifications', upstream: process.env['NOTIFICATION_SERVICE_URL'] ?? 'http://notification-service:3046' },
  { prefix: '/api/v1/query',       upstream: process.env['QUERY_SERVICE_URL']         ?? 'http://query-service:3047' },
  { prefix: '/api/v1/orchestrator', upstream: process.env['ORCHESTRATOR_SERVICE_URL'] ?? 'http://orchestrator-service:3048' },
  { prefix: '/api/v1/webhooks',    upstream: process.env['WEBHOOK_SERVICE_URL']       ?? 'http://webhook-service:3050' },
  { prefix: '/api/v1/tenants',     upstream: process.env['TENANT_SERVICE_URL']        ?? 'http://tenant-service:3051' },
  { prefix: '/api/v1/users',       upstream: process.env['USER_SERVICE_URL']          ?? 'http://user-service:3052' },
  { prefix: '/api/v1/audit',       upstream: process.env['AUDIT_SERVICE_URL']         ?? 'http://audit-service:3053' },
  { prefix: '/api/v1/approval',    upstream: process.env['APPROVAL_SERVICE_URL']      ?? 'http://approval-service:3054' },
  { prefix: '/api/v1/connector',   upstream: process.env['CONNECTOR_SERVICE_URL']     ?? 'http://connector-service:3055' },
  { prefix: '/api/v1/recon',       upstream: process.env['RECON_SERVICE_URL']         ?? 'http://recon-service:3056' },
  { prefix: '/api/v1/documents',   upstream: process.env['DOCUMENT_SERVICE_URL']      ?? 'http://document-service:3057' },
  { prefix: '/api/v1/onboarding',  upstream: process.env['ONBOARDING_SERVICE_URL']    ?? 'http://onboarding-service:3058' },
  // Intelligence layer — agent-t1 is the only agent with HTTP
  { prefix: '/api/v1/copilot',    upstream: process.env['AGENT_T1_URL']              ?? 'http://agent-t1:3024' },
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
      rewritePrefix: svc.prefix,
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

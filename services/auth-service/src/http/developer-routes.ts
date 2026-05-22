import { FastifyInstance } from 'fastify';
import * as crypto from 'crypto';
import pino from 'pino';

/**
 * Gap 10: API Marketplace / Developer Portal
 * Self-service API key management with usage tracking and rate limits.
 *
 * @security These routes are DEVELOPMENT ONLY. Gated by NODE_ENV check at registration.
 *   Use auth-service Prisma ApiKey model in production instead of in-memory store.
 */

const devLogger = pino({ name: 'developer-routes' });

interface DevKey {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  keyPrefix: string;     // First 8 chars for display
  scopes: string[];
  rateLimit: number;     // requests/hour
  isActive: boolean;
  createdAt: string;
  lastUsedAt?: string;
  usageCount: number;
}

interface KeyUsageEntry {
  timestamp: string;
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
}

// In-memory store for demo — production uses Prisma + ApiKey model
const devKeys = new Map<string, DevKey>();
const keyUsage = new Map<string, KeyUsageEntry[]>();

// Available API scopes for marketplace
const AVAILABLE_SCOPES = [
  { scope: 'gl:read', description: 'Read General Ledger data' },
  { scope: 'gl:write', description: 'Create/post journal entries' },
  { scope: 'payroll:read', description: 'Read payroll batches and employee data' },
  { scope: 'recon:read', description: 'Read reconciliation data' },
  { scope: 'recon:write', description: 'Create reconciliations and match transactions' },
  { scope: 'reports:read', description: 'Generate and read reports' },
  { scope: 'eom:read', description: 'Read EOM close status' },
  { scope: 'eom:write', description: 'Initiate and advance EOM close' },
  { scope: 'audit:read', description: 'Read audit trail events' },
  { scope: 'analytics:read', description: 'Access analytics and dashboards' },
  { scope: 'webhook:manage', description: 'Register and manage webhooks' },
];

// Seed a demo key
const demoId = 'devkey-demo-001';
devKeys.set(demoId, {
  id: demoId,
  tenantId: 'tenant-kunes',
  name: 'DMS Integration Key',
  description: 'Used by AutoMate DMS connector for nightly GL sync',
  keyPrefix: 'amacc_dk',
  scopes: ['gl:read', 'gl:write', 'recon:read'],
  rateLimit: 1000,
  isActive: true,
  createdAt: '2025-01-15T10:00:00Z',
  lastUsedAt: '2025-06-28T14:32:00Z',
  usageCount: 4521,
});
keyUsage.set(demoId, [
  { timestamp: '2025-06-28T14:32:00Z', endpoint: '/api/v1/gl/journal-entries', method: 'POST', statusCode: 201, latencyMs: 45 },
  { timestamp: '2025-06-28T14:31:55Z', endpoint: '/api/v1/gl/accounts', method: 'GET', statusCode: 200, latencyMs: 12 },
  { timestamp: '2025-06-28T14:30:00Z', endpoint: '/api/v1/gl/journal-entries', method: 'POST', statusCode: 201, latencyMs: 52 },
]);

export async function developerRoutes(app: FastifyInstance) {
  if (process.env['NODE_ENV'] !== 'development') {
    devLogger.warn('Developer routes requested but NODE_ENV is not development — skipping registration');
    return;
  }
  devLogger.warn('⚠️  Developer bypass routes are ACTIVE. Do not use in production.');

  // List all developer keys for tenant
  app.get('/api/v1/developer/keys', async (req, reply) => {
    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    const keys = Array.from(devKeys.values()).filter((k) => k.tenantId === tenantId);
    return reply.send(keys.map(({ ...k }) => k)); // keyPrefix only, never expose full key
  });

  // Create new developer key
  app.post<{ Body: { name: string; description?: string; scopes?: string[]; rateLimit?: number } }>(
    '/api/v1/developer/keys',
    async (req, reply) => {
        const tenantId = req.headers['x-tenant-id'] as string | undefined;
        if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const { name, description, scopes, rateLimit } = req.body || {};
      if (!name) return reply.status(400).send({ error: 'name is required' });

      const rawKey = `amacc_dk_${crypto.randomBytes(24).toString('hex')}`;
      const id = `devkey-${crypto.randomBytes(8).toString('hex')}`;

      const key: DevKey = {
        id,
        tenantId,
        name,
        description: description || '',
        keyPrefix: rawKey.slice(0, 16),
        scopes: scopes || ['gl:read'],
        rateLimit: rateLimit || 500,
        isActive: true,
        createdAt: new Date().toISOString(),
        usageCount: 0,
      };
      devKeys.set(id, key);
      keyUsage.set(id, []);

      return reply.status(201).send({
        ...key,
        rawKey, // Only returned once at creation
      });
    },
  );

  // Revoke (soft-delete) key
  app.delete<{ Params: { id: string } }>('/api/v1/developer/keys/:id', async (req, reply) => {
    const key = devKeys.get(req.params.id);
    if (!key) return reply.status(404).send({ error: 'Key not found' });
    key.isActive = false;
    return reply.send({ ok: true, id: key.id, status: 'revoked' });
  });

  // Get key usage history
  app.get<{ Params: { id: string } }>('/api/v1/developer/keys/:id/usage', async (req, reply) => {
    const key = devKeys.get(req.params.id);
    if (!key) return reply.status(404).send({ error: 'Key not found' });
    const usage = keyUsage.get(req.params.id) || [];
    return reply.send({
      keyId: key.id,
      name: key.name,
      totalRequests: key.usageCount,
      rateLimit: key.rateLimit,
      recentUsage: usage.slice(0, 50),
    });
  });

  // Get available scopes
  app.get('/api/v1/developer/scopes', async (_req, reply) => {
    return reply.send(AVAILABLE_SCOPES);
  });

  // API documentation / catalog
  app.get('/api/v1/developer/catalog', async (_req, reply) => {
    return reply.send({
      apis: [
        { name: 'General Ledger', base: '/api/v1/gl', version: 'v1', endpoints: 6, scopes: ['gl:read', 'gl:write'] },
        { name: 'Payroll', base: '/api/v1/payroll', version: 'v1', endpoints: 7, scopes: ['payroll:read'] },
        { name: 'Reconciliation', base: '/api/v1/recon', version: 'v1', endpoints: 6, scopes: ['recon:read', 'recon:write'] },
        { name: 'EOM Close', base: '/api/v1/eom', version: 'v1', endpoints: 6, scopes: ['eom:read', 'eom:write'] },
        { name: 'AP/AR', base: '/api/v1/apar', version: 'v1', endpoints: 4, scopes: ['gl:read', 'gl:write'] },
        { name: 'Reports', base: '/api/v1/reports', version: 'v1', endpoints: 3, scopes: ['reports:read'] },
        { name: 'Audit Trail', base: '/api/v1/audit', version: 'v1', endpoints: 3, scopes: ['audit:read'] },
        { name: 'Webhooks', base: '/api/v1/webhooks', version: 'v1', endpoints: 4, scopes: ['webhook:manage'] },
        { name: 'Analytics', base: '/api/v1/analytics', version: 'v1', endpoints: 4, scopes: ['analytics:read'] },
        { name: 'Connector', base: '/api/v1/connector', version: 'v1', endpoints: 5, scopes: ['gl:write'] },
      ],
      totalEndpoints: 48,
      documentation: '/api/v1/developer/docs',
    });
  });
}

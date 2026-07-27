import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import crypto from 'crypto';
import { authMiddleware, createAuthzGuard, HttpAuthzClient, IEventPublisher } from '@amacc/shared-kernel';
import { AuditService } from '../application/audit-service';

const CreateAuditSchema = z.object({
  tenantId: z.string().min(1),
  eventType: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  actorType: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
  action: z.string().min(1),
  previousState: z.record(z.unknown()).optional(),
  newState: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z.string().datetime().optional().transform((s) => s ? new Date(s) : undefined),
  ipAddress: z.string().optional(),
  sessionId: z.string().optional(),
  sourceEventId: z.string().optional(),
});

// ── S224 authorization (deny-by-default, centralized through real S207) ────────
export const AUDIT_PERMISSIONS = {
  VIEW: 'audit.view',
  EXPORT: 'audit.export',
} as const;

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

/**
 * S224's own AuthzClient wiring: audit-service has no tsyringe DI container
 * (unlike coa-service/tenant-service), so this is a plain module-level
 * client, consistent with the rest of this small service's style. Fails
 * closed exactly like every other S207 guard: a broken auth-service degrades
 * to "nothing is permitted", never "everything is permitted".
 */
const authzClient = new HttpAuthzClient({
  baseUrl: process.env['AUTHZ_SERVICE_URL'],
});
const requireAuditPermission = createAuthzGuard(authzClient, { getTenantId });

export function auditRoutes(auditService: AuditService, eventPublisher?: Pick<IEventPublisher, 'publish'>) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));


    // GET /api/v1/audit/log — List recent audit events for a tenant
    app.get('/log', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const logs = await auditService.getByTenant(tenantId).catch(() => []);
      return reply.send(logs);
    });

    // POST /api/v1/audit/log — Append one audit record
    app.post('/log', async (request, reply) => {
      const body = CreateAuditSchema.parse(request.body);
      const result = await auditService.log(body);
      return reply.status(201).send(result);
    });

    // GET /api/v1/audit/entity/:entityType/:entityId
    app.get('/entity/:entityType/:entityId', async (request, reply) => {
      const { entityType, entityId } = request.params as { entityType: string; entityId: string };
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      const logs = await auditService.getByEntity(entityType, entityId, tenantId);
      return reply.send(logs);
    });

    // GET /api/v1/audit/actor/:actorId
    app.get('/actor/:actorId', async (request, reply) => {
      const { actorId } = request.params as { actorId: string };
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      const logs = await auditService.getByActor(actorId, tenantId);
      return reply.send(logs);
    });

    // GET /api/v1/audit/period/:from/:to
    app.get('/period/:from/:to', async (request, reply) => {
      const { from, to } = request.params as { from: string; to: string };
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      const logs = await auditService.getByPeriod(from, to, tenantId);
      return reply.send(logs);
    });

    // GET /api/v1/audit/tenant — Get all audit logs for a tenant
    app.get('/tenant', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const logs = await auditService.getByTenant(tenantId);
      return reply.send(logs);
    });

    // GET /api/v1/audit/documents/:docType/:docId — S224 BR224-1: chronological
    // per-document audit timeline with field diffs. Empty array (200), never
    // 404/error, for a document with zero events (BR224 exception workflow).
    app.get('/documents/:docType/:docId', { preHandler: requireAuditPermission(AUDIT_PERMISSIONS.VIEW) }, async (request, reply) => {
      const { docType, docId } = request.params as { docType: string; docId: string };
      const tenantId = getTenantId(request);
      const events = await auditService.getDocumentHistory(tenantId, docType, docId);

      // BR224-3: viewing a document's history that contains at least one
      // PII-marked field diff is itself an auditable event.
      if (eventPublisher && auditService.historyContainsPii(events)) {
        await eventPublisher.publish({
          type: 'audit.viewed',
          tenantId,
          payload: {
            eventId: crypto.randomUUID(), docType, docId,
            viewer: (request as any).user?.sub ?? 'unknown', ts: new Date().toISOString(), schemaV: 1,
          },
          occurredAt: new Date(),
          correlationId: `audit-viewed:${docType}:${docId}:${Date.now()}`,
        }).catch((err) => request.log.error(err, 'failed to publish audit.viewed'));
      }

      return reply.send({ docType, docId, events });
    });

    // GET /api/v1/audit/documents/:docType/:docId/export — S224 BR224-4: CSV
    // export with exact parity to the on-screen timeline.
    app.get('/documents/:docType/:docId/export', { preHandler: requireAuditPermission(AUDIT_PERMISSIONS.EXPORT) }, async (request, reply) => {
      const { docType, docId } = request.params as { docType: string; docId: string };
      const tenantId = getTenantId(request);
      const events = await auditService.getDocumentHistory(tenantId, docType, docId);
      const csv = auditService.documentHistoryToCsv(events);
      reply.header('content-type', 'text/csv');
      reply.header('content-disposition', `attachment; filename="${docType}-${docId}-audit-history.csv"`);
      return reply.send(csv);
    });

    // GET /api/v1/audit/chain/verify?partitionKey=YYYY-MM:tenantId
    // BR7-2 tamper-detection: on-demand chain-verify for one partition.
    app.get('/chain/verify', async (request, reply) => {
      const partitionKey = (request.query as { partitionKey?: string }).partitionKey;
      if (!partitionKey) {
        return reply.status(400).send({ error: 'partitionKey query parameter is required' });
      }
      const result = await auditService.verifyChain(partitionKey);
      return reply.status(result.ok ? 200 : 409).send(result);
    });

    // GET /api/v1/audit/chain/partitions — list known partition keys, so an
    // operator or the periodic verify job can enumerate what to check.
    app.get('/chain/partitions', async (_request, reply) => {
      const partitions = await auditService.listPartitions();
      return reply.send({ partitions });
    });
  };
}

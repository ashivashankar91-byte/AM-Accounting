import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '@amacc/shared-kernel';
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
});

export function auditRoutes(auditService: AuditService) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

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
  };
}

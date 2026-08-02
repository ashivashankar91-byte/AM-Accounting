import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { CashPositionService } from '../application/cash-position-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export const CASH_POSITION_PERMISSIONS = {
  VIEW: 'cash.position.view',
  EXPORT: 'cash.position.export',
} as const;

function requirePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

/** Registered under /api/v1/cash. */
export async function cashPositionRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const cashPosition = container.resolve<CashPositionService>('CashPositionService');

  app.get('/position', { preHandler: requirePermission(CASH_POSITION_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      if (!q.entityId || !q.businessDate) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'entityId and businessDate are required query params' });
      }
      const result = await cashPosition.getDailyCashPosition({
        tenantId, entityId: q.entityId, businessDate: q.businessDate, jurisdiction: q.jurisdiction,
      });
      return reply.status(200).send(result);
    } catch (err) {
      if ((err as any)?.statusCode === 400) return reply.status(400).send({ error: 'BAD_REQUEST', message: (err as any).message });
      throw err;
    }
  });

  app.post('/position/export', { preHandler: requirePermission(CASH_POSITION_PERMISSIONS.EXPORT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = (request.body ?? {}) as { entityId?: string; businessDate?: string; jurisdiction?: string };
      if (!body.entityId || !body.businessDate) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'entityId and businessDate are required' });
      }
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await cashPosition.exportDailyCashPosition(
        { tenantId, entityId: body.entityId, businessDate: body.businessDate, jurisdiction: body.jurisdiction },
        actor,
      );
      return reply.status(201).send(result);
    } catch (err) {
      if ((err as any)?.statusCode === 400) return reply.status(400).send({ error: 'BAD_REQUEST', message: (err as any).message });
      throw err;
    }
  });

  app.get('/position/exports', { preHandler: requirePermission(CASH_POSITION_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      const result = await cashPosition.listExports(tenantId, {
        entityId: q.entityId, limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
      });
      return reply.status(200).send(result);
    } catch (err) {
      if ((err as any)?.statusCode === 400) return reply.status(400).send({ error: 'BAD_REQUEST', message: (err as any).message });
      throw err;
    }
  });
}

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { ClosePeriodService } from '../application/close-service';
import { UpstreamModuleClient } from '../infrastructure/upstream-module-client';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string)?.trim();
  if (!id) { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 401; throw e; }
  return id;
}

export async function closeRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }

  app.get('/health', async () => ({ status: 'ok', service: 'close-service' }));

  app.get('/state', { preHandler: requirePermission('close.view_readiness') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { legalEntityId, periodYear, periodMonth } = request.query as any;
    const svc = container.resolve(ClosePeriodService);
    const state = await svc.getState(tenantId, legalEntityId, parseInt(periodYear), parseInt(periodMonth));
    return reply.send(state ?? { state: 'NOT_READY' });
  });

  app.post('/transition', { preHandler: requirePermission('close.initiate') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const body = request.body as any;
    const actor = (request as any).user?.sub;
    const svc = container.resolve(ClosePeriodService);
    const result = await svc.transition(tenantId, body.legalEntityId, parseInt(body.periodYear), parseInt(body.periodMonth), body.toState, actor, body.reason);
    return reply.send(result);
  });

  app.get('/readiness', { preHandler: requirePermission('close.view_readiness') }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { legalEntityId, periodYear, periodMonth } = request.query as any;
    const upstreamClient = container.resolve(UpstreamModuleClient);
    const signals = await upstreamClient.getAllSignals(tenantId, legalEntityId, parseInt(periodYear), parseInt(periodMonth));
    const svc = container.resolve(ClosePeriodService);
    const result = await svc.getReadiness(tenantId, legalEntityId, parseInt(periodYear), parseInt(periodMonth), signals);
    return reply.send(result);
  });
}

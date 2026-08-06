import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { CurrencyService } from '../application/currency-service';

function getTenantId(request: any): string {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return id;
}

export async function currencyRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }


  app.get('/config/:legalEntityId', async (request, reply) => {
    await requirePermission('close.view')(request, reply);
    const { legalEntityId } = request.params as any;
    return reply.send(await container.resolve(CurrencyService).getConfig(getTenantId(request), legalEntityId));
  });

  app.post('/config', async (request, reply) => {
    await requirePermission('close.initiate')(request, reply);
    const tenantId = getTenantId(request);
    const body = request.body as any;
    return reply.send(await container.resolve(CurrencyService).setConfig(tenantId, body.legalEntityId, body));
  });

  app.post('/rates', async (request, reply) => {
    await requirePermission('close.initiate')(request, reply);
    return reply.code(201).send(await container.resolve(CurrencyService).addRate(getTenantId(request), request.body));
  });

  app.get('/rates', async (request, reply) => {
    await requirePermission('close.view')(request, reply);
    return reply.send(await container.resolve(CurrencyService).listRates(getTenantId(request), request.query));
  });

  app.post('/translation-preview', async (request, reply) => {
    await requirePermission('close.initiate')(request, reply);
    const tenantId = getTenantId(request);
    const body = request.body as any;
    const actor = (request as any).user?.sub;
    return reply.code(201).send(await container.resolve(CurrencyService).previewTranslation(tenantId, body.legalEntityId, parseInt(body.periodYear), parseInt(body.periodMonth), actor));
  });

  app.post('/translation/:id/approve', async (request, reply) => {
    await requirePermission('close.transition')(request, reply);
    const { id } = request.params as any;
    const actor = (request as any).user?.sub;
    return reply.send(await container.resolve(CurrencyService).approveTranslation(getTenantId(request), id, actor));
  });

  app.post('/translation/:id/post', async (request, reply) => {
    await requirePermission('close.final_close')(request, reply);
    const { id } = request.params as any;
    const actor = (request as any).user?.sub;
    return reply.send(await container.resolve(CurrencyService).postTranslation(getTenantId(request), id, actor));
  });
}

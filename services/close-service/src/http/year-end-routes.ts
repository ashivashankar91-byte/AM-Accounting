import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { YearEndService } from '../application/year-end-service';

function getTenantId(request: any): string {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return id;
}

export async function yearEndRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }


  app.post('/preview', async (request, reply) => {
    await requirePermission('close.year_end_run')(request, reply);
    const tenantId = getTenantId(request);
    const body = request.body as any;
    const actor = (request as any).user?.sub;
    return reply.code(201).send(await container.resolve(YearEndService).preview(tenantId, body.legalEntityId, parseInt(body.fiscalYear), actor));
  });

  app.post('/:id/approve', async (request, reply) => {
    await requirePermission('close.year_end_run')(request, reply);
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const actor = (request as any).user?.sub;
    return reply.send(await container.resolve(YearEndService).approve(tenantId, id, actor));
  });

  app.post('/:id/post', async (request, reply) => {
    await requirePermission('close.year_end_run')(request, reply);
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const actor = (request as any).user?.sub;
    return reply.send(await container.resolve(YearEndService).post(tenantId, id, actor));
  });
}

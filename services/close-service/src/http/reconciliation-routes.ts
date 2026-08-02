import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { ReconciliationService } from '../application/reconciliation-service';

function getTenantId(request: any): string {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return id;
}

export async function reconciliationRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }


  app.get('/register', async (request, reply) => {
    await requirePermission('close.view')(request, reply);
    const tenantId = getTenantId(request);
    return reply.send(await container.resolve(ReconciliationService).listRegister(tenantId, request.query));
  });

  app.post('/register', async (request, reply) => {
    await requirePermission('close.initiate')(request, reply);
    const tenantId = getTenantId(request);
    return reply.code(201).send(await container.resolve(ReconciliationService).createRegister(tenantId, request.body));
  });

  app.post('/register/:id/sign-off', async (request, reply) => {
    await requirePermission('close.transition')(request, reply);
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return reply.send(await container.resolve(ReconciliationService).signOff(tenantId, id, request.body));
  });

  app.post('/pbc-export', async (request, reply) => {
    await requirePermission('close.view')(request, reply);
    const tenantId = getTenantId(request);
    return reply.send({ tenantId, status: 'EXPORTED', exportedAt: new Date().toISOString() });
  });
}

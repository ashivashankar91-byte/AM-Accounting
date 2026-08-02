import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { ScrubService } from '../application/scrub-service';

function getTenantId(request: any): string {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return id;
}

export async function scrubRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }


  app.post('/runs', async (request, reply) => {
    await requirePermission('close.initiate')(request, reply);
    const tenantId = getTenantId(request);
    const body = request.body as any;
    const actor = (request as any).user?.sub;
    return reply.code(201).send(await container.resolve(ScrubService).runScrub(tenantId, body.legalEntityId, parseInt(body.periodYear), parseInt(body.periodMonth), actor));
  });

  app.get('/runs', async (request, reply) => {
    await requirePermission('close.view')(request, reply);
    const tenantId = getTenantId(request);
    return reply.send(await container.resolve(ScrubService).listRuns(tenantId, request.query));
  });

  app.get('/runs/:id/findings', async (request, reply) => {
    await requirePermission('close.view')(request, reply);
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    return reply.send(await container.resolve(ScrubService).getFindings(tenantId, id));
  });

  app.post('/findings/:id/dispose', async (request, reply) => {
    await requirePermission('close.override_exception')(request, reply);
    const tenantId = getTenantId(request);
    const { id } = request.params as any;
    const actor = (request as any).user?.sub;
    return reply.send(await container.resolve(ScrubService).disposeFinding(tenantId, id, { ...(request.body as any), actor }));
  });
}

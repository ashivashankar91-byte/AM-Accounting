import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { SnapshotService } from '../application/snapshot-service';

function getTenantId(request: any): string {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return id;
}

export async function snapshotRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }


  app.post('/', async (request, reply) => {
    await requirePermission('close.snapshot_sign')(request, reply);
    return reply.code(201).send(await container.resolve(SnapshotService).capture(getTenantId(request), request.body));
  });

  app.post('/:id/primary-sign', async (request, reply) => {
    await requirePermission('close.snapshot_sign')(request, reply);
    const { id } = request.params as any;
    const actor = (request as any).user?.sub;
    return reply.send(await container.resolve(SnapshotService).primarySign(getTenantId(request), id, { ...(request.body as any), signerId: actor }));
  });

  app.post('/:id/secondary-sign', async (request, reply) => {
    await requirePermission('close.snapshot_sign')(request, reply);
    const { id } = request.params as any;
    const actor = (request as any).user?.sub;
    return reply.send(await container.resolve(SnapshotService).secondarySign(getTenantId(request), id, { ...(request.body as any), signerId: actor }));
  });

  app.post('/:id/verify', async (request, reply) => {
    await requirePermission('close.snapshot_sign')(request, reply);
    const { id } = request.params as any;
    return reply.send(await container.resolve(SnapshotService).verify(getTenantId(request), id));
  });
}

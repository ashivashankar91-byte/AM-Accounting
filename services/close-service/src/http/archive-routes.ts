import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { ArchiveService } from '../application/archive-service';

function getTenantId(request: any): string {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return id;
}

export async function archiveRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }


  app.post('/', async (request, reply) => {
    await requirePermission('close.archive_manage')(request, reply);
    const actor = (request as any).user?.sub;
    return reply.code(201).send(await container.resolve(ArchiveService).create(getTenantId(request), { ...(request.body as any), createdBy: actor }));
  });

  app.get('/', async (request, reply) => {
    await requirePermission('close.archive_manage')(request, reply);
    return reply.send(await container.resolve(ArchiveService).list(getTenantId(request)));
  });

  app.get('/:id', async (request, reply) => {
    await requirePermission('close.archive_manage')(request, reply);
    const { id } = request.params as any;
    return reply.send(await container.resolve(ArchiveService).get(getTenantId(request), id));
  });

  app.delete('/:id', async (request, reply) => {
    await requirePermission('close.archive_manage')(request, reply);
    const { id } = request.params as any;
    return reply.send(await container.resolve(ArchiveService).delete(getTenantId(request), id));
  });

  app.post('/retention-schedules', async (request, reply) => {
    await requirePermission('close.archive_manage')(request, reply);
    const actor = (request as any).user?.sub;
    return reply.code(201).send(await container.resolve(ArchiveService).createRetentionSchedule(getTenantId(request), { ...(request.body as any), createdBy: actor }));
  });
}

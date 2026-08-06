import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { KpiService } from '../application/kpi-service';

function getTenantId(request: any): string {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return id;
}

export async function kpiRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }


  app.get('/formulas', async (request, reply) => {
    await requirePermission('close.kpi_manage')(request, reply);
    return reply.send(await container.resolve(KpiService).listFormulas(getTenantId(request)));
  });

  app.post('/formulas', async (request, reply) => {
    await requirePermission('close.kpi_manage')(request, reply);
    const tenantId = getTenantId(request);
    const actor = (request as any).user?.sub;
    return reply.code(201).send(await container.resolve(KpiService).createFormula(tenantId, { ...(request.body as any), createdBy: actor }));
  });

  app.post('/compute', async (request, reply) => {
    await requirePermission('close.kpi_manage')(request, reply);
    return reply.send(await container.resolve(KpiService).computeKpi(getTenantId(request), request.body));
  });
}

import { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { ComplianceServiceCe15 } from '../application/compliance-service-ce15';

function getTenantId(request: any): string {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return id;
}

export async function complianceRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  function requirePermission(permission: string) {
    return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
  }


  app.post('/generate', async (request, reply) => {
    await requirePermission('close.compliance_generate')(request, reply);
    const tenantId = getTenantId(request);
    const body = request.body as any;
    const actor = (request as any).user?.sub;
    return reply.code(201).send(await container.resolve(ComplianceServiceCe15).generate(tenantId, body.legalEntityId, parseInt(body.periodYear), parseInt(body.periodMonth), actor));
  });

  app.get('/', async (request, reply) => {
    await requirePermission('close.view')(request, reply);
    return reply.send(await container.resolve(ComplianceServiceCe15).list(getTenantId(request)));
  });
}

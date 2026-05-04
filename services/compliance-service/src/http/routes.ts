import { FastifyPluginAsync } from 'fastify';

export function complianceRoutes(prisma: any): FastifyPluginAsync {
  return async (app) => {
    app.get('/alerts', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const alerts = await prisma.complianceAlert.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }).catch(() => []);
      return reply.send(alerts);
    });

    app.get('/alerts/open', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const alerts = await prisma.complianceAlert.findMany({
        where: { tenantId, resolvedAt: null },
        orderBy: { createdAt: 'desc' },
      }).catch(() => []);
      return reply.send(alerts);
    });

    app.post('/alerts/:id/resolve', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const { id } = request.params as { id: string };
      const alert = await prisma.complianceAlert.update({
        where: { id },
        data: { resolvedAt: new Date() },
      });
      return reply.send(alert);
    });

    app.get('/rules', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const rules = await prisma.complianceRule.findMany({
        where: { tenantId },
      }).catch(() => []);
      return reply.send(rules);
    });
  };
}

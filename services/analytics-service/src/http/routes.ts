import { FastifyPluginAsync } from 'fastify';

export function analyticsRoutes(prisma: any): FastifyPluginAsync {
  return async (app) => {
    app.get('/pl', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const query = request.query as { period?: string };
      const now = new Date();
      const period = query.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const data = await prisma.aggMonthlyPL.findMany({ where: { tenantId, period } }).catch(() => []);
      if (data.length > 0) return reply.send({ period, departments: data });
      return reply.send({ period, departments: [], dataAvailable: false });
    });

    app.get('/tech-productivity', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const query = request.query as { period?: string };
      const now = new Date();
      const period = query.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const data = await prisma.aggTechProductivity.findMany({ where: { tenantId, period } }).catch(() => []);
      if (data.length > 0) return reply.send(data);
      return reply.send({ period, data: [], dataAvailable: false });
    });

    app.get('/parts-margin', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const query = request.query as { period?: string };
      const now = new Date();
      const period = query.period ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const data = await prisma.aggPartsMargin.findMany({ where: { tenantId, period } }).catch(() => []);
      if (data.length > 0) return reply.send(data);
      return reply.send({ period, data: [], dataAvailable: false });
    });

    app.get('/trend', async (request, reply) => {
      const query = request.query as { months?: string };
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const monthCount = parseInt(query.months ?? '6', 10);

      const data = await prisma.aggMonthlyPL.findMany({
        where: { tenantId },
        orderBy: { period: 'desc' },
        take: monthCount * 5,
      }).catch(() => []);

      if (data.length > 0) return reply.send(data);
      return reply.send({ data: [], dataAvailable: false });
    });
    app.get('/kpis', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const now = new Date();
      const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const plData = await prisma.aggMonthlyPL.findMany({ where: { tenantId, period } }).catch(() => []);
      return reply.send({ period, kpis: plData, dataAvailable: plData.length > 0 });
    });

  };
}

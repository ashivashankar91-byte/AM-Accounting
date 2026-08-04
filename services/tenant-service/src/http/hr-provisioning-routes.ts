/**
 * S005 — HR Role Provisioning Events: read-only audit log endpoint.
 */
import { FastifyInstance } from 'fastify';

export async function hrProvisioningRoutes(app: FastifyInstance) {
  // GET /api/v1/hr-provisioning/events
  app.get('/events', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string;
    if (!tenantId) {
      return reply.status(400).send({ error: 'x-tenant-id header required' });
    }
    const events = await (app as any).prisma.hrProvisioningEvent.findMany({
      where: { tenantId },
      orderBy: { processedAt: 'desc' },
      take: 200,
    });
    return reply.send(events);
  });
}

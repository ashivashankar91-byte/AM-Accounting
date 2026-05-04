import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { GroupService } from '../application/group-service';
import { authMiddleware } from '@amacc/shared-kernel';

export function groupRoutes(groupService: GroupService) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    app.post('/', async (request, reply) => {
      const { name } = z.object({ name: z.string().min(1) }).parse(request.body);
      const group = await groupService.createGroup(name);
      return reply.status(201).send(group);
    });

    app.get('/', async (_request, reply) => {
      const groups = await groupService.listGroups();
      return reply.send(groups);
    });

    app.post('/:id/tenants', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { tenantId, rooftopName } = z.object({
        tenantId: z.string().min(1),
        rooftopName: z.string().min(1),
      }).parse(request.body);
      const tenant = await groupService.addTenant(id, tenantId, rooftopName);
      return reply.status(201).send(tenant);
    });

    app.get('/:id/dashboard', async (request, reply) => {
      const { id } = request.params as { id: string };
      const dashboard = await groupService.getGroupDashboard(id);
      return reply.send(dashboard);
    });
  };
}

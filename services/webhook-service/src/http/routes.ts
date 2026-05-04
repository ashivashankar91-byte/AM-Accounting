import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WebhookService } from '../application/webhook-service';
import { authMiddleware } from '@amacc/shared-kernel';

const RegisterSchema = z.object({
  name: z.string().min(1),
  targetUrl: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().optional(),
});

export function webhookRoutes(webhookService: WebhookService) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
    if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required. webhook-service cannot start without it.');
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // POST /api/v1/webhooks — Register webhook
    app.post('/', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const body = RegisterSchema.parse(request.body);
      const result = await webhookService.register({ ...body, tenantId });
      return reply.status(201).send(result);
    });

    // GET /api/v1/webhooks — List webhooks for tenant
    app.get('/', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const webhooks = await webhookService.list(tenantId);
      return reply.send(webhooks);
    });

    // DELETE /api/v1/webhooks/:id — Deactivate
    app.delete('/:id', async (request, reply) => {
      const tenantId = (request.headers['x-tenant-id'] as string) || '';
      const { id } = request.params as { id: string };
      await webhookService.deactivate(id, tenantId);
      return reply.send({ deactivated: true });
    });

    // GET /api/v1/webhooks/:id/deliveries — Delivery history
    app.get('/:id/deliveries', async (request, reply) => {
      const { id } = request.params as { id: string };
      const deliveries = await webhookService.getDeliveries(id);
      return reply.send(deliveries);
    });
  };
}

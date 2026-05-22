import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { TenantService } from '../application/tenant-service';
import { authMiddleware } from '@amacc/shared-kernel';

const CreateTenantSchema = z.object({
  name: z.string().min(1).max(200),
  dmsType: z.enum(['AUTOMATE', 'CDK', 'REYNOLDS', 'DEALERTRACK']),
  dmsApiKey: z.string().min(1),
  rooftopCount: z.number().int().positive().optional(),
  webhookUrl: z.string().url().optional(),
});

const UpdateTenantSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  webhookUrl: z.string().url().nullable().optional(),
  rooftopCount: z.number().int().positive().optional(),
});

const ADMIN_API_KEY = process.env['ADMIN_API_KEY'];
if (!ADMIN_API_KEY) throw new Error('FATAL: ADMIN_API_KEY environment variable is required. tenant-service cannot start without it.');

function requireAdmin(request: any, reply: any): boolean {
  if (request.headers['x-admin-api-key'] !== ADMIN_API_KEY) {
    reply.status(403).send({ error: 'Admin access required' });
    return false;
  }
  return true;
}

export async function tenantRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required. tenant-service cannot start without it.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<TenantService>('TenantService');

  // POST / — Create tenant
  app.post('/', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const body = CreateTenantSchema.parse(request.body);
    const tenant = await svc.createTenant(body);
    return reply.status(201).send(tenant);
  });

  // GET / — List all tenants (admin only)
  app.get('/', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const tenants = await svc.getAllTenants();
    return reply.send(tenants);
  });

  // GET /:id — Get tenant details
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tenant = await svc.getTenantById(id);
    if (!tenant) return reply.status(404).send({ error: 'Tenant not found' });
    return reply.send(tenant);
  });

  // PATCH /:id — Update tenant config
  app.patch('/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    const body = UpdateTenantSchema.parse(request.body);
    const tenant = await svc.updateTenant(id, body);
    return reply.send(tenant);
  });

  // DELETE /:id — Soft delete
  app.delete('/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const { id } = request.params as { id: string };
    await svc.softDeleteTenant(id);
    return reply.status(204).send();
  });
}

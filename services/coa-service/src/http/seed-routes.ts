import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { SeedService, UnknownManifestError } from '../application/seed-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

// ── Authorization (deny-by-default, centralized through real S207) ────────────
// Permission string per packet §2: coa.seed.run.

export const SEED_PERMISSIONS = { RUN: 'coa.seed.run' } as const;

// R0 Stabilization Phase 3: centralized through the real S207 AuthzService
// (see account-routes.ts header comment for full rationale).
export function requireSeedPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof UnknownManifestError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  if ((error as any)?.statusCode === 400) {
    return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  }
  throw error;
}

const SeedSchema = z.object({
  entityId: z.string().min(1),
  manifestVersion: z.string().optional(),
  actor: z.string().min(1).optional(),
});

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────────
// Packet §9 uses colon-verb paths (/coa:seed, /coa:diff-from-canonical); these are
// rendered as path segments (/coa/seed, /coa/diff-from-canonical) for gateway
// compatibility — functionally identical (documented spec deviation).

export async function seedRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<SeedService>('SeedService');
  const actorOf = (request: any, body: any) =>
    body?.actor ?? (request.user?.sub as string | undefined) ?? 'system';

  // POST /coa/seed — idempotent per-entity seed.
  app.post('/seed', { preHandler: requireSeedPermission(SEED_PERMISSIONS.RUN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = SeedSchema.parse(request.body ?? {});
      const result = await svc.seed({
        tenantId,
        entityId: body.entityId,
        manifestVersion: body.manifestVersion,
        actor: actorOf(request, body),
      });
      return reply.status(201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /coa/diff-from-canonical?entity=&manifestVersion= — divergence report.
  app.get('/diff-from-canonical', { preHandler: requireSeedPermission(SEED_PERMISSIONS.RUN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { entity, manifestVersion } = request.query as { entity?: string; manifestVersion?: string };
      if (!entity) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'query param "entity" is required' });
      }
      return reply.send(await svc.diffFromCanonical(tenantId, entity, manifestVersion));
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

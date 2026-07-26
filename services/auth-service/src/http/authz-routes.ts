import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import {
  AuthzService,
  UnknownPermissionError,
  CatalogVersionNotFoundError,
  CATALOG_READ_PERMISSION,
} from '../application/authz-service';

// ── S207: /authz routes ────────────────────────────────────────────────────────
// GET /authz/check   — the gatekeeper (deny-by-default)
// GET /authz/catalog — versioned catalog + diff report
//
// Internal platform API: callers authenticate as services. Where a user context
// is supplied (x-user-id), catalog reads are guarded by iam.catalog.view.

const CheckQuerySchema = z.object({
  user:       z.string().min(1),
  permission: z.string().min(1),
  tenant:     z.string().min(1),
  entity:     z.string().min(1).optional(),
  store:      z.string().min(1).optional(),
});

const CatalogQuerySchema = z.object({
  version:  z.string().min(1).optional(),
  diffFrom: z.string().min(1).optional(),
});

export async function authzRoutes(app: FastifyInstance) {
  const svc = () => container.resolve<AuthzService>('AuthzService');

  // GET /authz/check?user&permission&tenant&entity&store
  app.get('/check', async (request, reply) => {
    const parsed = CheckQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'INVALID_REQUEST',
        message: 'user, permission and tenant query params are required',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const q = parsed.data;
    try {
      const result = await svc().check({
        userId: q.user,
        permissionKey: q.permission,
        scope: { tenantId: q.tenant, entityId: q.entity ?? null, storeId: q.store ?? null },
        route: (request.headers['x-guarded-route'] as string | undefined) ?? request.url,
      });
      return reply.status(200).send(result);
    } catch (err) {
      if (err instanceof UnknownPermissionError) {
        // Call-site typo guard (AC §3): unknown permission string → 400.
        return reply.status(400).send({ error: 'UNKNOWN_PERMISSION', message: err.message });
      }
      throw err;
    }
  });

  // GET /authz/catalog?version&diffFrom
  app.get('/catalog', async (request, reply) => {
    const parsed = CatalogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', message: 'invalid catalog query' });
    }

    // Optional user-context guard: if a user id is supplied, they must hold
    // iam.catalog.view. Pure service-to-service calls (no user) are allowed.
    const userId = (request.headers['x-user-id'] as string | undefined)?.trim();
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    if (userId && tenantId) {
      const gate = await svc().check({
        userId,
        permissionKey: CATALOG_READ_PERMISSION,
        scope: { tenantId },
        route: request.url,
      });
      if (!gate.allow) {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Missing permission: ' + CATALOG_READ_PERMISSION });
      }
    }

    try {
      const result = await svc().catalog({ version: parsed.data.version, diffFrom: parsed.data.diffFrom });
      return reply.status(200).send(result);
    } catch (err) {
      if (err instanceof CatalogVersionNotFoundError) {
        return reply.status(404).send({ error: 'VERSION_NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}

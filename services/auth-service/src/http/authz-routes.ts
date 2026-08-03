import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
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
  // Read lazily (inside the plugin function, not at module top level) so
  // importing this module never throws before a caller has had a chance to
  // set the env var — matches role-routes.ts/user-routes.ts's own
  // convention, not routes.ts's (that file is the auth-service entrypoint's
  // sole /auth registration, imported exactly once at real boot).
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required. auth-service cannot start without it.');

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

  // fix(integration) — GET /authz/my-permissions?entity&store — the caller's
  // own effective permission set in the given scope, derived from userId
  // (JWT sub, never a query param) so a user can never read another user's
  // grants. Feeds the frontend's client-side UI gating (disable/hide);
  // every actual write still runs check() itself, so this is UX only.
  const MyPermissionsQuerySchema = z.object({
    entity: z.string().min(1).optional(),
    store: z.string().min(1).optional(),
  });
  app.get('/my-permissions', { preHandler: authMiddleware(JWT_SECRET!) }, async (request, reply) => {
    const parsed = MyPermissionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', message: 'invalid my-permissions query' });
    }
    const userId = (request as any).user?.sub as string | undefined;
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    if (!userId || !tenantId) {
      return reply.status(400).send({ error: 'INVALID_REQUEST', message: 'authenticated user and x-tenant-id are required' });
    }
    const permissions = await svc().myPermissions(userId, {
      tenantId,
      entityId: parsed.data.entity ?? null,
      storeId: parsed.data.store ?? null,
    });
    return reply.status(200).send({ permissions });
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

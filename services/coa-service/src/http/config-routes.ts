import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import {
  ConfigService,
  ConfigUnknownKeyError,
  ConfigValidationError,
} from '../application/config-service';

// ── Tenant scoping ─────────────────────────────────────────────────────────────

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

// ── AuthzPort stub (deny-by-default static role map; S207 replacement) ──────────
// Permission strings per packet §2: config.view (read), config.manage (write).

export const CONFIG_PERMISSIONS = {
  VIEW: 'config.view',
  MANAGE: 'config.manage',
} as const;

const ROLE_PERMISSIONS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set([CONFIG_PERMISSIONS.VIEW, CONFIG_PERMISSIONS.MANAGE]),
  CONTROLLER: new Set([CONFIG_PERMISSIONS.VIEW, CONFIG_PERMISSIONS.MANAGE]),
  ACCOUNTANT: new Set([CONFIG_PERMISSIONS.VIEW]),
};

export function requireConfigPermission(permission: string) {
  return async function checkPermission(request: any, reply: any) {
    const role = request.user?.role as string | undefined;
    const granted = role ? (ROLE_PERMISSIONS[role] ?? new Set<string>()) : new Set<string>();
    if (!granted.has(permission)) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: `Missing required permission: ${permission}`,
      });
    }
  };
}

function handleError(error: unknown, reply: any) {
  if (error instanceof ConfigUnknownKeyError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }
  if (error instanceof ConfigValidationError) {
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

// ── Zod ────────────────────────────────────────────────────────────────────────

const PutSchema = z.object({
  scope: z.enum(['TENANT', 'ENTITY', 'STORE']),
  entityId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  value: z.string(),
  effectiveFrom: z.string().datetime().optional(),
  actor: z.string().min(1).optional(),
});

// ── Routes (registered under /api/v1/config) ────────────────────────────────────

export async function configRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<ConfigService>('ConfigService');

  // GET /config/catalog — the registry of allowed keys.
  app.get('/catalog', { preHandler: requireConfigPermission(CONFIG_PERMISSIONS.VIEW) }, async (request, reply) => {
    getTenantId(request);
    try {
      return reply.send({ keys: await svc.listCatalog() });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /config/:key?entity=&store= — resolved value + resolvedScope.
  app.get('/:key', { preHandler: requireConfigPermission(CONFIG_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { key } = request.params as { key: string };
    const { entity, store } = request.query as { entity?: string; store?: string };
    try {
      const resolved = await svc.resolve({ tenantId, key, entityId: entity, storeId: store });
      return reply.send(resolved);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PUT /config/:key — set a scoped, effective-dated value.
  app.put('/:key', { preHandler: requireConfigPermission(CONFIG_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { key } = request.params as { key: string };
    try {
      const body = PutSchema.parse(request.body);
      const result = await svc.put({
        tenantId,
        key,
        scope: body.scope,
        entityId: body.entityId,
        storeId: body.storeId,
        value: body.value,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
        actor: body.actor ?? (request.user?.sub as string | undefined) ?? 'system',
      });
      return reply.status(200).send({
        key,
        scope: result.setting.scope,
        value: result.setting.value,
        status: result.setting.status,
        effectiveFrom: result.setting.effectiveFrom,
        before: result.before.value,
      });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

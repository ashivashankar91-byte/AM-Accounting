import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  StoreService,
  StoreNotFoundError,
  StoreConflictError,
  StoreValidationError,
  STATE_PROVINCE_VALUES,
} from '../application/store-service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

// ── Authorization (deny-by-default, mirrors S200 pattern) ─────────────────────
//
// PRM201-1: acct.store.view (read) / acct.store.manage (create, edit, deactivate)

export const STORE_PERMISSIONS = {
  VIEW:   'acct.store.view',
  MANAGE: 'acct.store.manage',
} as const;

// R0 Stabilization Phase 3: local ROLE_PERMISSIONS stub replaced by the real
// S207 AuthzService via HttpAuthzClient (see legal-entity-routes.ts header
// comment for full rationale). Grants now live in auth-service's catalog.

function handleError(error: unknown, reply: any) {
  if (error instanceof StoreNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof StoreConflictError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof StoreValidationError) {
    const status = error.code === 'ORPHAN_STORE' ? 422 : 422;
    return reply.status(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  throw error;
}

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const STATE_PROVINCE_ENUM = z.enum(STATE_PROVINCE_VALUES as [string, ...string[]]);

const CreateSchema = z.object({
  entityId:     z.string().uuid(),
  storeCode:    z.string().min(2).max(6).regex(/^[A-Z0-9]+$/i).transform(s => s.toUpperCase()),
  storeName:    z.string().min(1).max(120),
  stateProvince: STATE_PROVINCE_ENUM,
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city:         z.string().max(100).optional(),
  postalCode:   z.string().max(20).optional(),
  dmvId:        z.string().max(20).optional(),
});

const UpdateSchema = z.object({
  version:      z.number().int().min(1),
  storeName:    z.string().min(1).max(120).optional(),
  stateProvince: STATE_PROVINCE_ENUM.optional(),
  addressLine1: z.string().max(200).optional(),
  addressLine2: z.string().max(200).optional(),
  city:         z.string().max(100).optional(),
  postalCode:   z.string().max(20).optional(),
  dmvId:        z.string().max(20).optional(),
});

const DeactivateSchema = z.object({
  version:       z.number().int().min(1),
  reason:        z.string().min(1).max(500),
  deactivatedBy: z.string().min(1).max(100),
});

// ── Route Registration ────────────────────────────────────────────────────────

export async function storeRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<StoreService>('StoreService');
  const requirePermission = createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId });

  // ── GET / — List with optional entityId/search/status filter ───────────────
  app.get('/', { preHandler: requirePermission(STORE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entityId, search, status, page, pageSize } = request.query as {
      entityId?: string;
      search?: string;
      status?: string;
      page?: string;
      pageSize?: string;
    };
    try {
      const result = await svc.list({
        tenantId,
        entityId:  entityId   || undefined,
        search:    search?.trim() || undefined,
        status:    status     || undefined,
        page:      page     ? parseInt(page,     10) : 1,
        pageSize:  pageSize ? parseInt(pageSize, 10) : 50,
      });
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── POST / — Create ─────────────────────────────────────────────────────────
  app.post('/', { preHandler: requirePermission(STORE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = CreateSchema.parse(request.body);
      const store = await svc.create({ ...body, tenantId }, request.user?.sub);
      return reply.status(201).send(store);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── GET /:id — Get by id ────────────────────────────────────────────────────
  app.get('/:id', { preHandler: requirePermission(STORE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const store = await svc.getById(tenantId, id);
      return reply.send(store);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── PUT /:id — Update ───────────────────────────────────────────────────────
  app.put('/:id', { preHandler: requirePermission(STORE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const body = UpdateSchema.parse(request.body);
      const store = await svc.update(tenantId, id, body, request.user?.sub);
      return reply.send(store);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── POST /:id/deactivate — Deactivate ───────────────────────────────────────
  app.post('/:id/deactivate', { preHandler: requirePermission(STORE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const body = DeactivateSchema.parse(request.body);
      const store = await svc.deactivate(tenantId, id, body);
      return reply.send(store);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

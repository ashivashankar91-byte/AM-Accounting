import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/tenant-client';
import {
  FranchiseService,
  FranchiseNotFoundError,
  StoreNotFoundForFranchiseError,
  FranchiseConflictError,
  FranchiseValidationError,
} from '../application/franchise-service';

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

// ── Authorization (deny-by-default) ──────────────────────────────────────────
// PRM204: acct.franchise.view (read) / acct.franchise.manage (create, edit)

export const FRANCHISE_PERMISSIONS = {
  VIEW:   'acct.franchise.view',
  MANAGE: 'acct.franchise.manage',
} as const;

// R0 Stabilization Phase 3: local ROLE_PERMISSIONS stub replaced by the real
// S207 AuthzService via HttpAuthzClient (see legal-entity-routes.ts header
// comment for full rationale). Grants now live in auth-service's catalog.

function handleError(error: unknown, reply: any) {
  if (error instanceof FranchiseNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof StoreNotFoundForFranchiseError) {
    return reply.status(404).send({ error: 'STORE_NOT_FOUND', message: error.message });
  }
  if (error instanceof FranchiseConflictError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof FranchiseValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  throw error;
}

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  oemCode:       z.string().min(1).max(20),   // list membership checked in service (422)
  dealerCode:    z.string().min(1).max(20),   // per-OEM format checked in service (422)
  effectiveFrom: z.string().min(1),
});

const UpdateSchema = z.object({
  version:     z.number().int().min(1),
  dealerCode:  z.string().min(1).max(20).optional(),
  effectiveTo: z.string().nullable().optional(),
});

// ── OEM reference routes (registered under /api/v1/oems) ───────────────────────

export async function oemRefRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const prisma = container.resolve<PrismaClient>('PrismaClient');
  const requirePermission = createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId });

  // GET /  → platform-controlled OEM list for franchise dropdowns
  app.get('/', { preHandler: requirePermission(FRANCHISE_PERMISSIONS.VIEW) }, async (_request, reply) => {
    const items = await prisma.oemRef.findMany({
      where: { active: true },
      orderBy: [{ displayName: 'asc' }],
    });
    return reply.send({ items, total: items.length });
  });
}

// ── Franchise routes (registered under /api/v1/stores) ─────────────────────────

export async function franchiseRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<FranchiseService>('FranchiseService');
  const requirePermission = createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId });

  // GET /:storeId/franchises
  app.get('/:storeId/franchises', { preHandler: requirePermission(FRANCHISE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { storeId } = request.params as { storeId: string };
    const { oemCode, active } = request.query as any;
    try {
      const result = await svc.list({
        tenantId, storeId, oemCode,
        active: active === 'true' || active === '1',
      });
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /:storeId/franchises
  app.post('/:storeId/franchises', { preHandler: requirePermission(FRANCHISE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { storeId } = request.params as { storeId: string };
    try {
      const body = CreateSchema.parse(request.body);
      const actor = (request as any).user?.userId ?? (request as any).user?.sub;
      const franchise = await svc.create({ tenantId, storeId, actor, ...body });
      return reply.status(201).send(franchise);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /:storeId/franchises/:id
  app.get('/:storeId/franchises/:id', { preHandler: requirePermission(FRANCHISE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { storeId, id } = request.params as { storeId: string; id: string };
    try {
      const franchise = await svc.getById(tenantId, storeId, id);
      return reply.send(franchise);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PATCH /:storeId/franchises/:id  (dealer code correction / buy-sell end-date)
  app.patch('/:storeId/franchises/:id', { preHandler: requirePermission(FRANCHISE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { storeId, id } = request.params as { storeId: string; id: string };
    try {
      const body = UpdateSchema.parse(request.body);
      const actor = (request as any).user?.userId ?? (request as any).user?.sub;
      const franchise = await svc.update(tenantId, storeId, id, { ...body, actor });
      return reply.send(franchise);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

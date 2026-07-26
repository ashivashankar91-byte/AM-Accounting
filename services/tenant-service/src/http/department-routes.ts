import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  DepartmentService,
  DepartmentNotFoundError,
  DepartmentConflictError,
  DepartmentValidationError,
} from '../application/department-service';

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
// PRM203: acct.dept.view (read) / acct.dept.manage (create, edit, deactivate)

export const DEPT_PERMISSIONS = {
  VIEW:   'acct.dept.view',
  MANAGE: 'acct.dept.manage',
} as const;

// R0 Stabilization Phase 3: local ROLE_PERMISSIONS stub replaced by the real
// S207 AuthzService via HttpAuthzClient (see legal-entity-routes.ts header
// comment for full rationale). Grants now live in auth-service's catalog.

function handleError(error: unknown, reply: any) {
  if (error instanceof DepartmentNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof DepartmentConflictError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof DepartmentValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  throw error;
}

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  code: z.string().min(1).max(2),  // range check done in service (returns 422, not 400)
  name: z.string().min(1).max(60),
});

const UpdateSchema = z.object({
  version: z.number().int().min(1),
  name:    z.string().min(1).max(60).optional(),
});

const DeactivateSchema = z.object({
  version:        z.number().int().min(1),
  reason:         z.string().min(1).max(500),
  deactivatedBy:  z.string().min(1).max(200),
});

// ── Routes (registered under /api/v1/entities) ────────────────────────────────

export async function departmentRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<DepartmentService>('DepartmentService');
  const requirePermission = createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId });

  // GET /:entityId/departments
  app.get('/:entityId/departments', { preHandler: requirePermission(DEPT_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entityId } = request.params as { entityId: string };
    const { status, search, page, pageSize } = request.query as any;
    try {
      const result = await svc.list({
        tenantId, entityId, status, search,
        page:     page     ? parseInt(page, 10)     : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      });
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /:entityId/departments
  app.post('/:entityId/departments', { preHandler: requirePermission(DEPT_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entityId } = request.params as { entityId: string };
    try {
      const body = CreateSchema.parse(request.body);
      const dept = await svc.create({ tenantId, entityId, ...body }, request.user?.sub);
      return reply.status(201).send(dept);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /:entityId/departments/seed  (idempotent canonical seed)
  app.post('/:entityId/departments/seed', { preHandler: requirePermission(DEPT_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entityId } = request.params as { entityId: string };
    try {
      await svc.seedCanonical(tenantId, entityId);
      const result = await svc.list({ tenantId, entityId });
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /:entityId/departments/:id
  app.get('/:entityId/departments/:id', { preHandler: requirePermission(DEPT_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entityId, id } = request.params as { entityId: string; id: string };
    try {
      const dept = await svc.getById(tenantId, entityId, id);
      return reply.send(dept);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PUT /:entityId/departments/:id
  app.put('/:entityId/departments/:id', { preHandler: requirePermission(DEPT_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entityId, id } = request.params as { entityId: string; id: string };
    try {
      const body = UpdateSchema.parse(request.body);
      const dept = await svc.update(tenantId, entityId, id, body, request.user?.sub);
      return reply.send(dept);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /:entityId/departments/:id/deactivate
  app.post('/:entityId/departments/:id/deactivate', { preHandler: requirePermission(DEPT_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entityId, id } = request.params as { entityId: string; id: string };
    try {
      const body = DeactivateSchema.parse(request.body);
      const dept = await svc.deactivate(tenantId, entityId, id, body);
      return reply.send(dept);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

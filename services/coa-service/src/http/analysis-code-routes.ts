import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  AnalysisCodeService,
  AnalysisCodeNotFoundError,
  AnalysisCodeConflictError,
  AnalysisCodeValidationError,
} from '../application/analysis-code-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

// ── Authorization (deny-by-default, centralized through the real S207) ────────
// Per the approved S011 Story Contract: `analysis.code.manage` (registry
// CRUD). VIEW is an additive, documented extension of the same convention
// used by acct.dept.view/manage (tenant-service/department-routes.ts) — a
// read-only surface distinct from manage so an Accountant tagging JE lines
// can list active types/values without holding registry-management rights.
export const ANALYSIS_CODE_PERMISSIONS = {
  VIEW: 'analysis.code.view',
  MANAGE: 'analysis.code.manage',
} as const;

function requireAnalysisPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof AnalysisCodeNotFoundError) {
    return reply.status(error.status).send({ error: error.code, message: error.message });
  }
  if (error instanceof AnalysisCodeConflictError) {
    return reply.status(error.status).send({ error: error.code, message: error.message });
  }
  if (error instanceof AnalysisCodeValidationError) {
    return reply.status(error.status).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  if ((error as any)?.statusCode === 400) {
    return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  }
  throw error;
}

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const CreateTypeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
});

const UpdateTypeSchema = z.object({
  version: z.number().int().min(1),
  name: z.string().min(1).max(120).optional(),
});

const CreateValueSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
});

const UpdateValueSchema = z.object({
  version: z.number().int().min(1),
  name: z.string().min(1).max(120).optional(),
});

const DeactivateSchema = z.object({
  version: z.number().int().min(1),
  reason: z.string().min(1).max(500),
  deactivatedBy: z.string().min(1).max(200).optional(),
});

const ListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: z.string().optional(),
});

// ── Routes (registered under /api/v1/coa) — CRUD /analysis/types(+values) ────
export async function analysisCodeRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<AnalysisCodeService>('AnalysisCodeService');
  const actorOf = (request: any) => (request.user?.sub as string | undefined) ?? 'system';

  // GET /analysis/types — list types (+ nested values) for the tenant registry screen (P01-SCR-04).
  app.get('/analysis/types', { preHandler: requireAnalysisPermission(ANALYSIS_CODE_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = ListQuerySchema.parse(request.query ?? {});
      const result = await svc.listTypes({ tenantId, ...q });
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /analysis/types/:id
  app.get('/analysis/types/:id', { preHandler: requireAnalysisPermission(ANALYSIS_CODE_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const type = await svc.getType(tenantId, id);
      return reply.send(type);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /analysis/types
  app.post('/analysis/types', { preHandler: requireAnalysisPermission(ANALYSIS_CODE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateTypeSchema.parse(request.body);
      const type = await svc.createType({ tenantId, ...body }, actorOf(request));
      return reply.status(201).send(type);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PUT /analysis/types/:id
  app.put('/analysis/types/:id', { preHandler: requireAnalysisPermission(ANALYSIS_CODE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = UpdateTypeSchema.parse(request.body);
      const type = await svc.updateType(tenantId, id, body, actorOf(request));
      return reply.send(type);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /analysis/types/:id/deactivate
  app.post('/analysis/types/:id/deactivate', { preHandler: requireAnalysisPermission(ANALYSIS_CODE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = DeactivateSchema.parse(request.body);
      const type = await svc.deactivateType(tenantId, id, { ...body, deactivatedBy: body.deactivatedBy ?? actorOf(request) });
      return reply.send(type);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /analysis/types/:id/values
  app.post('/analysis/types/:id/values', { preHandler: requireAnalysisPermission(ANALYSIS_CODE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = CreateValueSchema.parse(request.body);
      const value = await svc.createValue({ tenantId, typeId: id, ...body }, actorOf(request));
      return reply.status(201).send(value);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PUT /analysis/types/:typeId/values/:id
  app.put('/analysis/types/:typeId/values/:id', { preHandler: requireAnalysisPermission(ANALYSIS_CODE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { typeId: string; id: string };
      const body = UpdateValueSchema.parse(request.body);
      const value = await svc.updateValue(tenantId, id, body, actorOf(request));
      return reply.send(value);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /analysis/types/:typeId/values/:id/deactivate
  app.post(
    '/analysis/types/:typeId/values/:id/deactivate',
    { preHandler: requireAnalysisPermission(ANALYSIS_CODE_PERMISSIONS.MANAGE) },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params as { typeId: string; id: string };
        const body = DeactivateSchema.parse(request.body);
        const value = await svc.deactivateValue(tenantId, id, { ...body, deactivatedBy: body.deactivatedBy ?? actorOf(request) });
        return reply.send(value);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}

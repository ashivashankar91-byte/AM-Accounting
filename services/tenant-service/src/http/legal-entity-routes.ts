import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  LegalEntityService,
  LegalEntityNotFoundError,
  LegalEntityConflictError,
  LegalEntityValidationError,
} from '../application/legal-entity-service';

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

// ── Authorization (deny-by-default, centralized through S207) ─────────────────
//
// PRM200-1: acct.entity.view (read) / acct.entity.manage (create, edit, deactivate,
// mark-posted) are enforced per-route on top of the authMiddleware JWT check above.
// R0 Stabilization Phase 3: the local ROLE_PERMISSIONS stub map that used to live
// here was replaced by a call to the real S207 AuthzService (via HttpAuthzClient),
// registered as 'AuthzClient' in this service's DI container (src/index.ts).
// Role -> permission grants now live centrally in auth-service's permission/
// role_permission catalog (see services/auth-service/prisma/migrations/
// 20260726000001_extend_authz_catalog_r0_stabilization) instead of being
// duplicated here. Deny-by-default is enforced by the central engine itself.

export const LEGAL_ENTITY_PERMISSIONS = {
  VIEW:   'acct.entity.view',
  MANAGE: 'acct.entity.manage',
} as const;

function handleError(error: unknown, reply: any) {
  if (error instanceof LegalEntityNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof LegalEntityConflictError) {
    const status = error.code === 'VERSION_CONFLICT' ? 409 : 409;
    return reply.status(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof LegalEntityValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  throw error; // let Fastify handle unexpected errors
}

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

const CreateSchema = z.object({
  entityCode:         z.string().min(1).max(20).regex(/^[A-Z0-9_-]+$/i),
  legalName:          z.string().min(1).max(200),
  displayName:        z.string().max(100).optional(),
  statutoryId:        z.string().max(50).optional(),
  functionalCurrency: z.string().length(3).toUpperCase(),
  country:            z.string().length(2).toUpperCase(),
  fiscalYearEndMonth: z.number().int().min(1).max(12),
  address:            z.string().max(200).optional(),
  city:               z.string().max(100).optional(),
  state:              z.string().max(100).optional(),
  postalCode:         z.string().max(20).optional(),
  effectiveDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform(s => new Date(s)),
});

const UpdateSchema = z.object({
  version:            z.number().int().min(1),
  effectiveDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform(s => new Date(s)),
  legalName:          z.string().min(1).max(200).optional(),
  displayName:        z.string().max(100).optional(),
  statutoryId:        z.string().max(50).optional(),
  country:            z.string().length(2).toUpperCase().optional(),
  fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
  address:            z.string().max(200).optional(),
  city:               z.string().max(100).optional(),
  state:              z.string().max(100).optional(),
  postalCode:         z.string().max(20).optional(),
});

const DeactivateSchema = z.object({
  version:      z.number().int().min(1),
  reason:       z.string().min(1).max(500),
  deactivatedBy: z.string().min(1).max(100),
});

// ── Route Registration ────────────────────────────────────────────────────────

export async function legalEntityRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<LegalEntityService>('LegalEntityService');
  const requirePermission = createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId });

  // ── GET / — List with search and status filter ──────────────────────────────
  app.get('/', { preHandler: requirePermission(LEGAL_ENTITY_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { search, status, page, pageSize } = request.query as {
      search?: string;
      status?: string;
      page?: string;
      pageSize?: string;
    };
    try {
      const result = await svc.list({
        tenantId,
        search: search?.trim() || undefined,
        status: status || undefined,
        page:     page     ? parseInt(page,     10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 50,
      });
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── POST / — Create ─────────────────────────────────────────────────────────
  app.post('/', { preHandler: requirePermission(LEGAL_ENTITY_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = CreateSchema.parse(request.body);
      const { entity, warnDuplicateStatutoryId } = await svc.create({ ...body, tenantId });
      const status = warnDuplicateStatutoryId ? 201 : 201;
      return reply
        .status(status)
        .send({ ...entity, warnDuplicateStatutoryId });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── GET /:id — Get by id ───────────────────────────────────────────────────
  app.get('/:id', { preHandler: requirePermission(LEGAL_ENTITY_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const entity = await svc.getById(tenantId, id);
      return reply.send(entity);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── PUT /:id — Effective-dated update ──────────────────────────────────────
  app.put('/:id', { preHandler: requirePermission(LEGAL_ENTITY_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const body = UpdateSchema.parse(request.body);
      const { entity, warnDuplicateStatutoryId } = await svc.update(tenantId, id, body);
      return reply.send({ ...entity, warnDuplicateStatutoryId });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── POST /:id/deactivate — Deactivate ──────────────────────────────────────
  app.post('/:id/deactivate', { preHandler: requirePermission(LEGAL_ENTITY_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      const body = DeactivateSchema.parse(request.body);
      const entity = await svc.deactivate(tenantId, id, body);
      return reply.send(entity);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── GET /:id/audit — Audit history from audit-service ─────────────────────
  app.get('/:id/audit', { preHandler: requirePermission(LEGAL_ENTITY_PERMISSIONS.VIEW) }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const auditUrl =
      (process.env['AUDIT_SERVICE_URL'] ?? 'http://audit-service:3031') +
      `/api/v1/audit/entity/LegalEntity/${id}`;
    try {
      const res = await fetch(auditUrl, {
        headers: { 'x-tenant-id': getTenantId(request) },
      });
      if (!res.ok) return reply.send([]);
      const data = await res.json();
      return reply.send(data);
    } catch {
      return reply.send([]);
    }
  });

  // ── POST /:id/mark-posted — Called by GL service on first post ──────────────
  app.post('/:id/mark-posted', { preHandler: requirePermission(LEGAL_ENTITY_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { id } = request.params as { id: string };
    try {
      await svc.markHasPostedJournals(tenantId, id);
      return reply.status(204).send();
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

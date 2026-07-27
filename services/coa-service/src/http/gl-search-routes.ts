import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  GLSearchService,
  SearchCriteriaRequiredError,
  InvalidSearchRangeError,
  SavedSearchNotFoundError,
  DuplicateSearchNameError,
  GLSearchCriteria,
} from '../application/gl-search-service';

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
// Permission per the approved S221 Story Contract: inquiry.search
// (see services/auth-service/prisma/migrations/20260728020000_extend_authz_catalog_gl_search).
export const SEARCH_PERMISSIONS = {
  SEARCH: 'inquiry.search',
} as const;

export function requireSearchPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof SavedSearchNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof DuplicateSearchNameError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof SearchCriteriaRequiredError || error instanceof InvalidSearchRangeError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  if ((error as any)?.statusCode === 400) {
    return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  }
  throw error;
}

const SearchQuerySchema = z.object({
  entityId: z.string().optional(),
  amount: z.coerce.number().optional(),
  amountMin: z.coerce.number().optional(),
  amountMax: z.coerce.number().optional(),
  direction: z.enum(['DEBIT', 'CREDIT']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sourceCode: z.string().optional(),
  memoContains: z.string().optional(),
  postedBy: z.string().optional(),
  docRef: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

const SaveSearchBodySchema = z.object({
  name: z.string().min(1).max(120),
  criteria: SearchQuerySchema,
});

const RunSavedSearchQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

function toCriteria(q: z.infer<typeof SearchQuerySchema>): GLSearchCriteria {
  return { ...q };
}

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────────
// S221 — GL Search. Cross-account ledger search reusing the frozen S220
// ActivityLineView contract (plus accountId/accountNumber, minus
// runningBalance — see gl-search-service.ts header). Mounted under the
// already-gateway-routed /api/v1/coa prefix, avoiding a new gateway route
// entry (same convention as S220).
export async function glSearchRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<GLSearchService>('GLSearchService');

  const actorOf = (request: any) => ({
    userId: (request.user?.sub as string | undefined) ?? 'system',
    role: request.user?.role as string | undefined,
  });

  app.get('/inquiry/search', { preHandler: requireSearchPermission(SEARCH_PERMISSIONS.SEARCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = SearchQuerySchema.parse(request.query ?? {});
      const result = await svc.search(tenantId, toCriteria(q), actorOf(request));
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/inquiry/searches', { preHandler: requireSearchPermission(SEARCH_PERMISSIONS.SEARCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = SaveSearchBodySchema.parse(request.body ?? {});
      const saved = await svc.saveSearch(tenantId, actorOf(request), body.name, toCriteria(body.criteria));
      return reply.status(201).send(saved);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/inquiry/searches', { preHandler: requireSearchPermission(SEARCH_PERMISSIONS.SEARCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const list = await svc.listSavedSearches(tenantId, actorOf(request));
      return reply.status(200).send({ results: list });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get(
    '/inquiry/searches/:id/run',
    { preHandler: requireSearchPermission(SEARCH_PERMISSIONS.SEARCH) },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const id = (request.params as any).id as string;
        const q = RunSavedSearchQuerySchema.parse(request.query ?? {});
        const result = await svc.runSavedSearch(tenantId, actorOf(request), id, q.page, q.pageSize);
        return reply.status(200).send(result);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  app.delete(
    '/inquiry/searches/:id',
    { preHandler: requireSearchPermission(SEARCH_PERMISSIONS.SEARCH) },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const id = (request.params as any).id as string;
        await svc.deleteSavedSearch(tenantId, actorOf(request), id);
        return reply.status(204).send();
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}

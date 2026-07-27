import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  OrgService,
  OrgNodeNotFoundError,
  OrgValidationError,
  orgTreeToCsv,
} from '../application/org-service';

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

// ── Authorization (deny-by-default, centralized S207) ───────────────────────
// PRM202: org.tree.view (read tree/export) / org.tree.manage (re-parent)

export const ORG_PERMISSIONS = {
  VIEW:   'org.tree.view',
  MANAGE: 'org.tree.manage',
} as const;

function handleError(error: unknown, reply: any) {
  if (error instanceof OrgNodeNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof OrgValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  throw error;
}

// ── Zod Schemas ───────────────────────────────────────────────────────────────

const ReparentSchema = z.object({
  nodeType:      z.enum(['STORE', 'FRANCHISE']),
  nodeId:        z.string().min(1),
  newParentId:   z.string().min(1),
  effectiveFrom: z.string().min(1),
});

// ── Routes (registered under /api/v1/org) ────────────────────────────────────

export async function orgRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<OrgService>('OrgService');
  const requirePermission = createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId });

  // GET /tree?asOf=date&format=csv  — S202 BR202-3: CSV export must match
  // the tree screen exactly, so both are served from the same resolved tree.
  app.get('/tree', { preHandler: requirePermission(ORG_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { asOf, format } = request.query as { asOf?: string; format?: string };
    try {
      const tree = await svc.getTree(tenantId, asOf);
      if (format === 'csv') {
        const rows = await svc.toCsvRows(tree);
        const csv = orgTreeToCsv(rows);
        reply.header('content-type', 'text/csv');
        reply.header('content-disposition', `attachment; filename="org-tree-${tenantId}.csv"`);
        return reply.send(csv);
      }
      return reply.send(tree);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /tree:reparent
  app.post('/tree:reparent', { preHandler: requirePermission(ORG_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = ReparentSchema.parse(request.body);
      const actor = (request as any).user?.userId ?? (request as any).user?.sub;
      const result = await svc.reparent({ tenantId, actor, ...body });
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

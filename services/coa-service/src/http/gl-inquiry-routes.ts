import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { AccountNotFoundError } from '../application/account-service';
import {
  GLInquiryService,
  RangeRequiredError,
  RangeConflictError,
  InvalidRangeError,
  UnknownPresetError,
  PeriodNotFoundError,
} from '../application/gl-inquiry-service';

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
// Permission per the approved S220 Story Contract: inquiry.account.view
// (shared by both the view and CSV-export actions — see
// services/auth-service/prisma/migrations/20260728000001_extend_authz_catalog_gl_inquiry).
export const INQUIRY_PERMISSIONS = {
  VIEW: 'inquiry.account.view',
} as const;

export function requireInquiryPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof AccountNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof PeriodNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof UnknownPresetError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }
  if (error instanceof RangeRequiredError || error instanceof RangeConflictError || error instanceof InvalidRangeError) {
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

const QuerySchema = z.object({
  periodCode: z.string().optional(),
  preset: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  storeId: z.string().optional(),
  deptCode: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional(),
});

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────────
// S220 — GL Account Activity Inquiry. Read-only: beginning balance, period
// activity (with running balance), ending balance, drill-down keys into
// S217, and CSV export (BR220-3). Mounted under the already-gateway-routed
// /api/v1/coa prefix, avoiding a new gateway route entry.
export async function glInquiryRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<GLInquiryService>('GLInquiryService');

  app.get(
    '/inquiry/accounts/:id/activity',
    { preHandler: requireInquiryPermission(INQUIRY_PERMISSIONS.VIEW) },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const accountId = (request.params as any).id as string;
        const q = QuerySchema.parse(request.query ?? {});
        const view = await svc.getActivity(tenantId, accountId, q, {
          userId: (request.user?.sub as string | undefined) ?? 'system',
          role: request.user?.role as string | undefined,
        });
        return reply.status(200).send(view);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  app.get(
    '/inquiry/accounts/:id/activity:export',
    { preHandler: requireInquiryPermission(INQUIRY_PERMISSIONS.VIEW) },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const accountId = (request.params as any).id as string;
        const q = QuerySchema.parse(request.query ?? {});
        const csv = await svc.exportCsv(tenantId, accountId, q, {
          userId: (request.user?.sub as string | undefined) ?? 'system',
          role: request.user?.role as string | undefined,
        });
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="gl-inquiry-${accountId}.csv"`);
        return reply.status(200).send(csv);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}

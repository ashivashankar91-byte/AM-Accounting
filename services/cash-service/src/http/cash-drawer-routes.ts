import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { DrawerService, DrawerValidationError, ActiveDrawerConflictError, DrawerNotFoundError } from '../application/cash-drawer-service';
import { BlindCloseService, DrawerNotFoundError as BCDrawerNotFoundError, DrawerNotOpenError, BlindCloseValidationError } from '../application/blind-close-service';
import {
  ReconciliationService, DrawerNotFoundError as ReconDrawerNotFoundError, VarianceNotFoundError,
  ApprovalReasonRequiredError, ApprovalNotEligibleError, ReconcileNotEligibleError,
} from '../application/reconciliation-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export const CASH_PERMISSIONS = {
  DRAWER_OPEN: 'cash.drawer.open',
  DRAWER_VIEW_OWN: 'cash.drawer.view_own',
  DRAWER_VIEW_ALL: 'cash.drawer.view_all',
  DRAWER_BLIND_CLOSE: 'cash.drawer.blind_close',
  DRAWER_RECONCILE: 'cash.drawer.reconcile',
  VARIANCE_APPROVE: 'cash.variance.approve',
} as const;

export function requireCashPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

/**
 * S052 BR: a cashier may only transact against / close their OWN drawer.
 * cash.drawer.view_all is also the "act on any drawer" override — held only
 * by ADMIN/CONTROLLER among the roles that also hold the day-to-day cash.*
 * action permissions (SUPERVISOR deliberately does not hold drawer.open or
 * blind_close at all — see the S052 authz-catalog migration's role design),
 * so this reuses that same key rather than minting a new one.
 */
async function assertOwnDrawerOrPrivileged(request: any, tenantId: string, actor: string, drawerCashierId: string) {
  if (drawerCashierId === actor) return;
  const authz = container.resolve<AuthzClient>('AuthzClient');
  const allowed = await authz.check({
    userId: actor, permissionKey: CASH_PERMISSIONS.DRAWER_VIEW_ALL,
    scope: { tenantId, entityId: null, storeId: null }, route: request.routeOptions?.url ?? request.url,
  });
  if (!allowed.allow) {
    const e: any = new Error("Cannot act on another cashier's drawer — missing cash.drawer.view_all");
    e.statusCode = 403;
    e.code = 'FORBIDDEN';
    throw e;
  }
}

function handleError(error: unknown, reply: any) {
  if (
    error instanceof DrawerNotFoundError || error instanceof BCDrawerNotFoundError || error instanceof ReconDrawerNotFoundError
  ) {
    return reply.status(404).send({ error: 'DRAWER_NOT_FOUND', message: error.message });
  }
  if (error instanceof VarianceNotFoundError) {
    return reply.status((error as any).status ?? 409).send({ error: error.code, message: error.message });
  }
  if (error instanceof ActiveDrawerConflictError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof DrawerValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message, violations: error.violations });
  }
  if (error instanceof DrawerNotOpenError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof BlindCloseValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof ApprovalReasonRequiredError || error instanceof ApprovalNotEligibleError || error instanceof ReconcileNotEligibleError) {
    return reply.status((error as any).status ?? 409).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  if ((error as any)?.statusCode === 400) {
    return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  }
  if ((error as any)?.statusCode === 403) {
    return reply.status(403).send({ error: (error as any).code ?? 'FORBIDDEN', message: (error as any).message });
  }
  throw error;
}

const OpenDrawerSchema = z.object({
  storeId: z.string().min(1),
  storeCode: z.string().min(1),
  terminalCode: z.string().min(1),
  entityId: z.string().min(1),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'businessDate must be YYYY-MM-DD'),
  currency: z.string().length(3).optional(),
  openingFloat: z.union([z.number(), z.string()]),
  cashierName: z.string().nullable().optional(),
});

const BlindCloseCheckLineSchema = z.object({
  checkNumber: z.string().nullable().optional(),
  amount: z.union([z.number(), z.string()]),
});

const BlindCloseSchema = z.object({
  countedCash: z.union([z.number(), z.string()]),
  checkCount: z.number().int().nonnegative(),
  checkTotal: z.union([z.number(), z.string()]),
  retainedFloat: z.union([z.number(), z.string()]),
  cashierNote: z.string().nullable().optional(),
  checks: z.array(BlindCloseCheckLineSchema).optional(),
});

const ApproveVarianceSchema = z.object({
  reason: z.string().min(1),
});

/** Registered under /api/v1/cash. */
export async function cashDrawerRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const drawers = container.resolve<DrawerService>('DrawerService');
  const blindClose = container.resolve<BlindCloseService>('BlindCloseService');
  const recon = container.resolve<ReconciliationService>('ReconciliationService');

  // POST /drawers — open a cashier drawer.
  app.post('/drawers', { preHandler: requireCashPermission(CASH_PERMISSIONS.DRAWER_OPEN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = OpenDrawerSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const drawer = await drawers.open({ ...body, tenantId, cashierId: actor, actor });
      return reply.status(201).send(drawer);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /drawers/active — the caller's own active drawer (BR: cash.drawer.view_own).
  // A caller who ALSO holds cash.drawer.view_all may pass ?cashierId= to look
  // up a different cashier's active drawer (supervisor use).
  app.get('/drawers/active', { preHandler: requireCashPermission(CASH_PERMISSIONS.DRAWER_VIEW_OWN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const q = request.query as { cashierId?: string; storeId?: string };
      let cashierId = actor;
      if (q.cashierId && q.cashierId !== actor) {
        const authz = container.resolve<AuthzClient>('AuthzClient');
        const allowed = await authz.check({
          userId: actor, permissionKey: CASH_PERMISSIONS.DRAWER_VIEW_ALL,
          scope: { tenantId, entityId: null, storeId: null }, route: request.routeOptions?.url ?? request.url,
        });
        if (!allowed.allow) {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Missing required permission: cash.drawer.view_all' });
        }
        cashierId = q.cashierId;
      }
      const drawer = await drawers.getActive(tenantId, cashierId, q.storeId ?? null);
      return reply.status(200).send({ drawer });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /drawers/:drawerId — own drawer, or any drawer with cash.drawer.view_all.
  app.get('/drawers/:drawerId', { preHandler: requireCashPermission(CASH_PERMISSIONS.DRAWER_VIEW_OWN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const { drawerId } = request.params as { drawerId: string };
      const drawer = await drawers.getById(tenantId, drawerId);
      if (drawer.cashierId !== actor) {
        const authz = container.resolve<AuthzClient>('AuthzClient');
        const allowed = await authz.check({
          userId: actor, permissionKey: CASH_PERMISSIONS.DRAWER_VIEW_ALL,
          scope: { tenantId, entityId: null, storeId: null }, route: request.routeOptions?.url ?? request.url,
        });
        if (!allowed.allow) {
          return reply.status(403).send({ error: 'FORBIDDEN', message: 'Missing required permission: cash.drawer.view_all' });
        }
      }
      return reply.status(200).send(drawer);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /drawers/:drawerId/blind-close — cashier blind count submission.
  // Response deliberately excludes expected totals/variance (BR).
  app.post('/drawers/:drawerId/blind-close', { preHandler: requireCashPermission(CASH_PERMISSIONS.DRAWER_BLIND_CLOSE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { drawerId } = request.params as { drawerId: string };
      const body = BlindCloseSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const drawer = await drawers.getById(tenantId, drawerId);
      await assertOwnDrawerOrPrivileged(request, tenantId, actor, drawer.cashierId);
      const result = await blindClose.submit({ ...body, tenantId, drawerId, actor });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /drawers/:drawerId/reconciliation — supervisor-only detail.
  app.get('/drawers/:drawerId/reconciliation', { preHandler: requireCashPermission(CASH_PERMISSIONS.DRAWER_RECONCILE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { drawerId } = request.params as { drawerId: string };
      const view = await recon.getReconciliation(tenantId, drawerId);
      return reply.status(200).send(view);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /drawers/:drawerId/variance:approve
  app.post('/drawers/:drawerId/variance:approve', { preHandler: requireCashPermission(CASH_PERMISSIONS.VARIANCE_APPROVE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { drawerId } = request.params as { drawerId: string };
      const body = ApproveVarianceSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await recon.approveVariance({ tenantId, drawerId, reason: body.reason, actor });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /drawers/:drawerId/reconcile — final, permanent close.
  app.post('/drawers/:drawerId/reconcile', { preHandler: requireCashPermission(CASH_PERMISSIONS.DRAWER_RECONCILE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { drawerId } = request.params as { drawerId: string };
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await recon.reconcile({ tenantId, drawerId, actor });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  ReceiptService, ReceiptInputError, ReceiptValidationError, DrawerNotFoundError, DrawerNotOpenError,
  ReceiptNotFoundError, VoidReasonRequiredError, VoidNotEligibleError,
} from '../application/cash-receipt-service';
import { DrawerService } from '../application/cash-drawer-service';
import { CASH_PERMISSIONS } from './cash-drawer-routes';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export const CASH_RECEIPT_PERMISSIONS = {
  CREATE: 'cash.receipt.create',
  VIEW: 'cash.receipt.view',
  REPRINT: 'cash.receipt.reprint',
  VOID: 'cash.receipt.void',
} as const;

export function requireCashReceiptPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

/**
 * S052 BR: a cashier may only issue/void receipts against their OWN drawer.
 * cash.drawer.view_all is the same "act on any drawer" override used by
 * GET /drawers/:drawerId and the blind-close route in cash-drawer-routes.ts
 * — held only by ADMIN/CONTROLLER among the roles that also hold
 * cash.receipt.create/void, per the S052 authz-catalog migration.
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
  if (error instanceof DrawerNotFoundError || error instanceof ReceiptNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof DrawerNotOpenError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof ReceiptValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message, violations: error.violations });
  }
  if (error instanceof VoidReasonRequiredError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof VoidNotEligibleError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof ReceiptInputError) {
    return reply.status(400).send({ error: error.code, message: error.message });
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

const TenderSchema = z.object({
  tenderType: z.enum(['CASH', 'CHECK']),
  amount: z.union([z.number(), z.string()]),
  cashTendered: z.union([z.number(), z.string()]).nullable().optional(),
  checkNumber: z.string().nullable().optional(),
  checkPayer: z.string().nullable().optional(),
});

const CreateReceiptSchema = z.object({
  entityId: z.string().min(1),
  sourceDocType: z.string().min(1),
  sourceDocId: z.string().min(1),
  sourceDisplayNumber: z.string().nullable().optional(),
  payerReference: z.string().nullable().optional(),
  amountDue: z.union([z.number(), z.string()]).nullable().optional(),
  totalAmount: z.union([z.number(), z.string()]),
  currency: z.string().length(3).optional(),
  tenders: z.array(TenderSchema).min(1),
  idempotencyKey: z.string().min(1),
});

const VoidReceiptSchema = z.object({
  reason: z.string().min(1),
});

/** Registered under /api/v1/cash. */
export async function cashReceiptRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const receipts = container.resolve<ReceiptService>('ReceiptService');
  const drawers = container.resolve<DrawerService>('DrawerService');

  // POST /drawers/:drawerId/receipts — issue a cash/check receipt.
  app.post('/drawers/:drawerId/receipts', { preHandler: requireCashReceiptPermission(CASH_RECEIPT_PERMISSIONS.CREATE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { drawerId } = request.params as { drawerId: string };
      const body = CreateReceiptSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const drawer = await drawers.getById(tenantId, drawerId);
      await assertOwnDrawerOrPrivileged(request, tenantId, actor, drawer.cashierId);
      const receipt = await receipts.createReceipt({ ...body, tenantId, drawerId, actor });
      return reply.status(receipt.idempotent ? 200 : 201).send(receipt);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /receipts — search.
  app.get('/receipts', { preHandler: requireCashReceiptPermission(CASH_RECEIPT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      const result = await receipts.searchReceipts(tenantId, {
        receiptNumber: q.receiptNumber, sourceDocId: q.sourceDocId, cashierId: q.cashierId,
        drawerId: q.drawerId, status: q.status, storeId: q.storeId,
        limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
      });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /receipts/:receiptId
  app.get('/receipts/:receiptId', { preHandler: requireCashReceiptPermission(CASH_RECEIPT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { receiptId } = request.params as { receiptId: string };
      const receipt = await receipts.getReceiptById(tenantId, receiptId);
      return reply.status(200).send(receipt);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /receipts/:receiptId/print — printable representation; audits a (re)print.
  app.get('/receipts/:receiptId/print', { preHandler: requireCashReceiptPermission(CASH_RECEIPT_PERMISSIONS.REPRINT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { receiptId } = request.params as { receiptId: string };
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const receipt = await receipts.getPrintable(tenantId, receiptId, actor);
      return reply.status(200).send(receipt);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /receipts/:receiptId/void
  app.post('/receipts/:receiptId/void', { preHandler: requireCashReceiptPermission(CASH_RECEIPT_PERMISSIONS.VOID) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { receiptId } = request.params as { receiptId: string };
      const body = VoidReceiptSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const receipt = await receipts.getReceiptById(tenantId, receiptId);
      const drawer = await drawers.getById(tenantId, receipt.drawerId);
      await assertOwnDrawerOrPrivileged(request, tenantId, actor, drawer.cashierId);
      const result = await receipts.voidReceipt({ tenantId, receiptId, reason: body.reason, actor });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  DepositService, DepositInputError, DepositNotFoundError, ReceiptNotEligibleError,
  DepositNotPostableError, DepositNotVoidableError,
} from '../application/deposit-service';
import {
  BankFeedService, BankFeedInputError, BankFeedLineNotFoundError,
  BankFeedLineAlreadyMatchedError, BankFeedTargetNotFoundError,
} from '../application/bank-feed-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export const CASH_DEPOSIT_PERMISSIONS = {
  CREATE: 'cash.deposit.create',
  VIEW: 'cash.deposit.view',
  POST: 'cash.deposit.post',
  VOID: 'cash.deposit.void',
  BANKFEED_IMPORT: 'cash.bankfeed.import',
  BANKFEED_MATCH: 'cash.bankfeed.match',
} as const;

function requireDepositPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof DepositNotFoundError || error instanceof BankFeedLineNotFoundError || error instanceof BankFeedTargetNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (
    error instanceof ReceiptNotEligibleError || error instanceof DepositNotPostableError ||
    error instanceof DepositNotVoidableError || error instanceof BankFeedLineAlreadyMatchedError
  ) {
    return reply.status(409).send({ error: (error as any).code, message: error.message });
  }
  if (error instanceof DepositInputError || error instanceof BankFeedInputError) {
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

const CreateDepositSchema = z.object({
  entityId: z.string().min(1),
  storeId: z.string().min(1),
  bankAccountCode: z.string().min(1),
  businessDate: z.string().min(1),
  receiptIds: z.array(z.string().min(1)).min(1),
  idempotencyKey: z.string().min(1),
});

const VoidDepositSchema = z.object({ reason: z.string().min(1) });

const ManualFeedLineSchema = z.object({
  bankAccountCode: z.string().min(1),
  externalId: z.string().nullable().optional(),
  amount: z.union([z.number(), z.string()]),
  valueDate: z.string().min(1),
  description: z.string().nullable().optional(),
});

const MatchFeedLineSchema = z.object({
  depositId: z.string().min(1).optional(),
  receiptId: z.string().min(1).optional(),
});

/** Registered under /api/v1/cash. */
export async function depositRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const deposits = container.resolve<DepositService>('DepositService');
  const bankFeed = container.resolve<BankFeedService>('BankFeedService');

  app.post('/deposits', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.CREATE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateDepositSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await deposits.createDepositBatch({ ...body, tenantId, actor });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/deposits', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      const result = await deposits.search(tenantId, {
        status: q.status, storeId: q.storeId, bankAccountCode: q.bankAccountCode,
        limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
      });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/deposits/:depositId', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { depositId } = request.params as { depositId: string };
      return reply.status(200).send(await deposits.getById(tenantId, depositId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/deposits/:depositId/slip', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { depositId } = request.params as { depositId: string };
      return reply.status(200).send(await deposits.getDepositSlip(tenantId, depositId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/deposits/:depositId/post', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.POST) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { depositId } = request.params as { depositId: string };
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await deposits.postDeposit(tenantId, depositId, actor);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/deposits/:depositId/void', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.VOID) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { depositId } = request.params as { depositId: string };
      const body = VoidDepositSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await deposits.voidDeposit(tenantId, depositId, body.reason, actor);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── Bank feed ──────────────────────────────────────────────────────────
  app.get('/bank-feed/status', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.VIEW) }, async (_request, reply) => {
    return reply.status(200).send(bankFeed.getAdapterStatus());
  });

  app.get('/bank-feed/lines', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      const result = await bankFeed.search(tenantId, {
        status: q.status, bankAccountCode: q.bankAccountCode,
        limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
      });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/bank-feed/lines', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.BANKFEED_IMPORT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = ManualFeedLineSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const line = await bankFeed.importManualLine({ ...body, tenantId, actor });
      return reply.status(201).send(line);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/bank-feed/sync', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.BANKFEED_IMPORT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { bankAccountCode } = (request.body ?? {}) as { bankAccountCode?: string };
      if (!bankAccountCode) throw new BankFeedInputError('bankAccountCode is required');
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await bankFeed.syncFeed(tenantId, bankAccountCode, actor);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/bank-feed/lines/:feedLineId/match', { preHandler: requireDepositPermission(CASH_DEPOSIT_PERMISSIONS.BANKFEED_MATCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { feedLineId } = request.params as { feedLineId: string };
      const body = MatchFeedLineSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await bankFeed.matchLine({ tenantId, feedLineId, ...body, actor });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  SettlementService, SettlementInputError, SettlementBatchNotFoundError, SettlementNotPostableError,
  ChargebackNotFoundError, ChargebackAlreadyDispositionedError,
} from '../application/settlement-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export const SETTLEMENT_PERMISSIONS = {
  IMPORT: 'cash.settlement.import',
  VIEW: 'cash.settlement.view',
  MATCH: 'cash.settlement.match',
  POST: 'cash.settlement.post',
  CHARGEBACK_INTAKE: 'cash.settlement.chargeback_intake',
  CHARGEBACK_DISPOSITION: 'cash.settlement.chargeback_disposition',
} as const;

function requireSettlementPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof SettlementBatchNotFoundError || error instanceof ChargebackNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof SettlementNotPostableError || error instanceof ChargebackAlreadyDispositionedError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof SettlementInputError) {
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

const ImportBatchSchema = z.object({
  entityId: z.string().min(1),
  bankAccountCode: z.string().min(1),
  processorName: z.string().min(1),
  batchReference: z.string().min(1),
  settlementDate: z.string().min(1),
  grossAmount: z.union([z.number(), z.string()]),
  feeAmount: z.union([z.number(), z.string()]),
  netAmount: z.union([z.number(), z.string()]),
  idempotencyKey: z.string().min(1),
});

const MatchLineSchema = z.object({
  receiptId: z.string().min(1).optional(),
  depositId: z.string().min(1).optional(),
  amount: z.union([z.number(), z.string()]),
});

const WorklistItemSchema = z.object({
  batchId: z.string().min(1).optional(),
  bankAccountCode: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  cardLast4: z.string().nullable().optional(),
  transactionRef: z.string().nullable().optional(),
});

const ChargebackIntakeSchema = z.object({
  entityId: z.string().min(1),
  batchId: z.string().min(1).optional(),
  customerId: z.string().nullable().optional(),
  amount: z.union([z.number(), z.string()]),
  reasonCode: z.string().nullable().optional(),
});

const ChargebackDispositionSchema = z.object({
  dispositionAction: z.enum(['CUSTOMER_RESPONSIBILITY', 'MERCHANT_ABSORBED']),
});

/** Registered under /api/v1/cash. */
export async function settlementRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const settlement = container.resolve<SettlementService>('SettlementService');

  app.get('/settlements/status', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.VIEW) }, async (_r, reply) => {
    return reply.status(200).send(settlement.getAdapterStatus());
  });

  app.post('/settlements/batches', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.IMPORT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = ImportBatchSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await settlement.importBatch({ ...body, tenantId, actor });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/settlements/batches', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      return reply.status(200).send(await settlement.search(tenantId, { status: q.status, limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/settlements/batches/:batchId', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { batchId } = request.params as { batchId: string };
      return reply.status(200).send(await settlement.getById(tenantId, batchId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/settlements/batches/:batchId/match', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.MATCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { batchId } = request.params as { batchId: string };
      const body = MatchLineSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      return reply.status(201).send(await settlement.matchLine({ tenantId, batchId, ...body, actor }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/settlements/batches/:batchId/post', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.POST) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { batchId } = request.params as { batchId: string };
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      return reply.status(200).send(await settlement.postBatch(tenantId, batchId, actor));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/settlements/worklist', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      return reply.status(200).send(await settlement.listWorklist(tenantId, { status: q.status }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/settlements/worklist', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.MATCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = WorklistItemSchema.parse(request.body ?? {});
      return reply.status(201).send(await settlement.addToWorklist({ ...body, tenantId }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/settlements/worklist/:itemId/resolve', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.MATCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { itemId } = request.params as { itemId: string };
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      return reply.status(200).send(await settlement.resolveWorklistItem(tenantId, itemId, actor));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/settlements/chargebacks', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.CHARGEBACK_INTAKE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = ChargebackIntakeSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      return reply.status(201).send(await settlement.intakeChargeback({ ...body, tenantId, actor }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/settlements/chargebacks/:chargebackId/disposition', { preHandler: requireSettlementPermission(SETTLEMENT_PERMISSIONS.CHARGEBACK_DISPOSITION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { chargebackId } = request.params as { chargebackId: string };
      const body = ChargebackDispositionSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      return reply.status(200).send(await settlement.dispositionChargeback({ tenantId, chargebackId, ...body, actor }));
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

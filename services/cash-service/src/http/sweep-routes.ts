import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { SweepService } from '../application/sweep-service';
import { FpOffsetService, FpOffsetInputError, FpOffsetAllocationNotFoundError, FpOffsetAllocationNotPostableError } from '../application/fp-offset-service';
import { SweepInputError, SweepConfigNotFoundError, SweepNotFoundError, SweepNotPostableError, SweepNotVoidableError } from '../domain/sweep';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export const SWEEP_PERMISSIONS = {
  CONFIG: 'cash.sweep.config',
  RECORD: 'cash.sweep.record',
  VIEW: 'cash.sweep.view',
  POST: 'cash.sweep.post',
  VOID: 'cash.sweep.void',
  FPOFFSET_CREATE: 'cash.fpoffset.create',
  FPOFFSET_VIEW: 'cash.fpoffset.view',
  FPOFFSET_POST: 'cash.fpoffset.post',
} as const;

function requirePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof SweepNotFoundError || error instanceof SweepConfigNotFoundError || error instanceof FpOffsetAllocationNotFoundError) {
    return reply.status(404).send({ error: (error as any).code, message: error.message });
  }
  if (error instanceof SweepNotPostableError || error instanceof SweepNotVoidableError || error instanceof FpOffsetAllocationNotPostableError) {
    return reply.status(409).send({ error: (error as any).code, message: error.message });
  }
  if ((error as any)?.status === 409) {
    return reply.status(409).send({ error: (error as any).code, message: (error as any).message });
  }
  if (error instanceof SweepInputError || error instanceof FpOffsetInputError) {
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

const ConfigureSweepPairSchema = z.object({
  entityId: z.string().min(1),
  storeAccountCode: z.string().min(1),
  operatingAccountCode: z.string().min(1),
});

const RecordSweepSchema = z.object({
  pairConfigId: z.string().min(1),
  sweepDate: z.string().min(1),
  direction: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  confirmationState: z.enum(['MANUAL_RECORDED', 'FEED_CONFIRMED']).optional(),
  idempotencyKey: z.string().min(1),
});

const VoidSweepSchema = z.object({ reason: z.string().min(1) });

const CreateFpOffsetSchema = z.object({
  entityId: z.string().min(1),
  lenderName: z.string().min(1),
  statementDate: z.string().min(1),
  statementAmount: z.union([z.number(), z.string()]),
  lines: z.array(z.object({ floorplanUnitRef: z.string().min(1), amount: z.union([z.number(), z.string()]) })).min(1),
  idempotencyKey: z.string().min(1),
});

/** Registered under /api/v1/cash. */
export async function sweepRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const sweeps = container.resolve<SweepService>('SweepService');
  const fpOffset = container.resolve<FpOffsetService>('FpOffsetService');

  app.post('/sweeps/pairs', { preHandler: requirePermission(SWEEP_PERMISSIONS.CONFIG) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = ConfigureSweepPairSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await sweeps.configurePair({ ...body, tenantId, actor });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/sweeps/pairs', { preHandler: requirePermission(SWEEP_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      return reply.status(200).send(await sweeps.listPairs(tenantId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sweeps', { preHandler: requirePermission(SWEEP_PERMISSIONS.RECORD) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = RecordSweepSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await sweeps.recordSweep({ ...body, tenantId, actor });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/sweeps', { preHandler: requirePermission(SWEEP_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      const result = await sweeps.search(tenantId, {
        status: q.status, pairConfigId: q.pairConfigId,
        limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
      });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/sweeps/:sweepId', { preHandler: requirePermission(SWEEP_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { sweepId } = request.params as { sweepId: string };
      return reply.status(200).send(await sweeps.getById(tenantId, sweepId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sweeps/:sweepId/post', { preHandler: requirePermission(SWEEP_PERMISSIONS.POST) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { sweepId } = request.params as { sweepId: string };
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      return reply.status(200).send(await sweeps.postSweep(tenantId, sweepId, actor));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sweeps/:sweepId/void', { preHandler: requirePermission(SWEEP_PERMISSIONS.VOID) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { sweepId } = request.params as { sweepId: string };
      const body = VoidSweepSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      return reply.status(200).send(await sweeps.voidSweep(tenantId, sweepId, body.reason, actor));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── FP-offset allocation ────────────────────────────────────────────────
  app.post('/fp-offset-allocations', { preHandler: requirePermission(SWEEP_PERMISSIONS.FPOFFSET_CREATE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateFpOffsetSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await fpOffset.createAllocation({ ...body, tenantId, actor });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/fp-offset-allocations', { preHandler: requirePermission(SWEEP_PERMISSIONS.FPOFFSET_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string>;
      const result = await fpOffset.search(tenantId, {
        status: q.status, lenderName: q.lenderName,
        limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined,
      });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/fp-offset-allocations/:allocationId', { preHandler: requirePermission(SWEEP_PERMISSIONS.FPOFFSET_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { allocationId } = request.params as { allocationId: string };
      return reply.status(200).send(await fpOffset.getById(tenantId, allocationId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/fp-offset-allocations/:allocationId/post', { preHandler: requirePermission(SWEEP_PERMISSIONS.FPOFFSET_POST) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { allocationId } = request.params as { allocationId: string };
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      return reply.status(200).send(await fpOffset.postAllocation(tenantId, allocationId, actor));
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

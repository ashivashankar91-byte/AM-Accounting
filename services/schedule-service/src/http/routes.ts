import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { asTenantId, authMiddleware } from '@amacc/shared-kernel';
import { ScheduleApplicationService } from '../application/schedule-service';
import {
  ScheduleNotFoundError,
  ScheduleDetailNotFoundError,
  ScheduleValidationError,
  IncompatibleTypeChangeError,
  InvalidPurgeCodeError,
  DuplicateGlAccountError,
  MultipleAccountsNotAllowedError,
  NoAccountsError,
  ScheduleAccessDeniedError,
  PendingEventsError,
} from '../domain/errors';

function requireTenantId(request: any, reply: any): string | null {
  const id = request.headers['x-tenant-id'] as string | undefined;
  if (!id || !id.trim()) {
    reply.status(401).send({ error: 'Missing required header: x-tenant-id' });
    return null;
  }
  return id.trim();
}

function handleError(err: unknown, reply: any): void {
  if (err instanceof ScheduleNotFoundError || err instanceof ScheduleDetailNotFoundError) {
    reply.status(404).send({ error: (err as Error).message });
  } else if (
    err instanceof ScheduleValidationError ||
    err instanceof InvalidPurgeCodeError ||
    err instanceof DuplicateGlAccountError ||
    err instanceof MultipleAccountsNotAllowedError ||
    err instanceof NoAccountsError ||
    err instanceof IncompatibleTypeChangeError
  ) {
    reply.status(422).send({ error: (err as Error).message, code: (err as any).code });
  } else if (err instanceof ScheduleAccessDeniedError) {
    reply.status(403).send({ error: (err as Error).message });
  } else if (err instanceof PendingEventsError) {
    reply.status(409).send({ error: (err as Error).message, code: (err as any).code });
  } else {
    reply.status(500).send({ error: 'Internal server error' });
    console.error('[schedule-service] Unhandled error:', err);
  }
}

// DTO schemas
const CreateScheduleSchema = z.object({
  scheduleNumber: z.string().length(2).regex(/^[0-9]{2}$/),
  title: z.string().min(1).max(29),
  reportSequence: z.enum(['C', 'N', 'A']).optional(),
  scheduleType: z.number().int().min(1).max(5),
  glAccountNumbers: z.array(z.string().min(1)).min(1),
  eomPurgeType: z.number().int().min(1).max(7),
  controlNameDisplay: z.string().max(1).optional(),
});

const UpdateScheduleSchema = CreateScheduleSchema.partial().omit({ scheduleNumber: true });

const CreateDetailSchema = z.object({
  controlNumber: z.string().min(1).max(10),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  referenceNumber: z.string().optional(),
  journalSource: z.string().optional(),
  transactionDate: z.string().datetime().optional(),
  glAccountNumber: z.string().optional(),
  description: z.string().optional(),
  applyNumber: z.string().optional(),
  applyCd: z.string().optional(),
});

const PurgeRequestSchema = z.object({
  closeDate: z.string().datetime(),
  eomCloseId: z.string().min(1),
});

const ReportRequestSchema = z.object({
  format: z.enum(['DETAIL', 'SUMMARY']).default('DETAIL'),
  includeZeroBalance: z.boolean().default(false),
  cutoffDate: z.string().datetime(),
  scheduleNumber: z.string().length(2).optional(),
});

const PermissionsSchema = z.record(z.string(), z.boolean());

export async function scheduleRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('AMACC_JWT_SECRET environment variable is required but not set');
  }

  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve(ScheduleApplicationService);

  // ---------------------------------------------------------------------------
  // Schedule master CRUD
  // ---------------------------------------------------------------------------

  app.get('/api/v1/schedules', async (req, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await svc.listSchedules(tenantId));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post('/api/v1/schedules', async (req, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = CreateScheduleSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
    }
    try {
      const schedule = await svc.createSchedule(tenantId, body.data as any);
      reply.status(201).send(schedule);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/schedules/:id', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await svc.getSchedule(tenantId, req.params.id));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.put('/api/v1/schedules/:id', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = UpdateScheduleSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
    }
    try {
      reply.send(await svc.updateSchedule(tenantId, req.params.id, body.data as any));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.delete('/api/v1/schedules/:id', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      await svc.deleteSchedule(tenantId, req.params.id);
      reply.status(204).send();
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ---------------------------------------------------------------------------
  // Schedule detail CRUD
  // ---------------------------------------------------------------------------

  app.get('/api/v1/schedules/:id/details', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const q = req.query as any;
    const filters = {
      controlNumber: q.controlNumber,
      fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
      toDate: q.toDate ? new Date(q.toDate) : undefined,
      includeBalanceForward: q.includeBalanceForward !== 'false',
    };
    try {
      reply.send(await svc.listDetails(tenantId, req.params.id, filters));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/schedules/:id/details/summary', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await svc.getDetailSummary(tenantId, req.params.id));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.post('/api/v1/schedules/:id/details', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = CreateDetailSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
    }
    try {
      const data = {
        ...body.data,
        amount: body.data.amount as any, // Decimal coercion happens in repo
        transactionDate: body.data.transactionDate ? new Date(body.data.transactionDate) : undefined,
      };
      const detail = await svc.createDetail(tenantId, req.params.id, data as any);
      reply.status(201).send(detail);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.delete('/api/v1/schedules/:id/details/:detailId', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      await svc.deleteDetail(tenantId, req.params.id, req.params.detailId);
      reply.status(204).send();
    } catch (err) {
      handleError(err, reply);
    }
  });

  // PUT /api/v1/schedules/:id/details/:detailId — update editable detail fields
  // @trace-cobol komdetail.cbl REPLACE-DETAIL paragraph + schedup.cbl EDT-DETAIL validations
  const UpdateDetailSchema = z.object({
    amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
    referenceNumber: z.string().max(20).optional(),
    journalSource: z.string().max(2).optional(),
    transactionDate: z.string().datetime().optional(),
    description: z.string().max(200).optional(),
    balanceCurrent: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
    balanceOver30: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
    balanceOver60: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
    balanceOver90: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional(),
  });

  app.put('/api/v1/schedules/:id/details/:detailId', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = UpdateDetailSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
    }
    try {
      const dto = {
        ...body.data,
        transactionDate: body.data.transactionDate ? new Date(body.data.transactionDate) : undefined,
      };
      const detail = await svc.updateDetail(tenantId, req.params.id, req.params.detailId, dto as any);
      reply.send(detail);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // PATCH /api/v1/schedules/:id/details/:detailId/apply-number — set apply linkage
  // @trace-cobol komdetail.cbl APPLY-NUMBER / APPLY-CD fields
  const ApplyNumberSchema = z.object({
    applyNumber: z.string().max(10).nullable(),
    applyCd: z.string().max(1).nullable().optional(),
  });

  app.patch('/api/v1/schedules/:id/details/:detailId/apply-number', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = ApplyNumberSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
    }
    try {
      const detail = await svc.updateDetailApplyNumber(
        tenantId,
        req.params.id,
        req.params.detailId,
        body.data.applyNumber,
        body.data.applyCd ?? null,
      );
      reply.send(detail);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ---------------------------------------------------------------------------
  // Purge
  // ---------------------------------------------------------------------------

  app.post('/api/v1/schedules/purge', async (req, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = PurgeRequestSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
    }
    try {
      const summary = await svc.purgeAll({
        tenantId,
        closeDate: new Date(body.data.closeDate),
        eomCloseId: body.data.eomCloseId,
      });
      reply.send(summary);
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/schedules/purge/preview', async (req, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const q = req.query as any;
    if (!q.closeDate) {
      return reply.status(400).send({ error: 'closeDate query parameter required' });
    }
    try {
      const summary = await svc.previewPurge(tenantId, new Date(q.closeDate));
      reply.send(summary);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ---------------------------------------------------------------------------
  // Reports
  // @trace-cobol schedprn.cbl — DETAIL and SUMMARY report modes
  // ---------------------------------------------------------------------------

  app.get('/api/v1/schedules/report', async (req, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const q = req.query as any;
    const parsed = ReportRequestSchema.safeParse({
      format: q.format ?? 'DETAIL',
      includeZeroBalance: q.includeZeroBalance === 'true',
      cutoffDate: q.cutoffDate,
      scheduleNumber: q.scheduleNumber,
    });
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid query parameters', issues: parsed.error.issues });
    }
    try {
      const userId = (req as any).user?.sub ?? 'anonymous';
      const report = await svc.generateReport({
        tenantId,
        userId,
        ...parsed.data,
        cutoffDate: new Date(parsed.data.cutoffDate),
      });
      reply.send(report);
    } catch (err) {
      handleError(err, reply);
    }
  });

  // ---------------------------------------------------------------------------
  // Security — per-user per-schedule access
  // @trace-cobol schedsec.cbl
  // ---------------------------------------------------------------------------

  app.get('/api/v1/schedules/security/users/:userId', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await svc.getUserPermissions(tenantId, req.params.userId));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.put('/api/v1/schedules/security/users/:userId', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const body = PermissionsSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ error: 'Expected { [scheduleNumber]: boolean }' });
    }
    try {
      await svc.setUserPermissions(tenantId, req.params.userId, body.data);
      reply.status(204).send();
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.delete('/api/v1/schedules/security/users/:userId', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      await svc.deleteUserPermissions(tenantId, req.params.userId);
      reply.status(204).send();
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/schedules/security/users', async (req, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    try {
      reply.send(await svc.listUsersWithAccess(tenantId));
    } catch (err) {
      handleError(err, reply);
    }
  });

  app.get('/api/v1/schedules/:id/security/check', async (req: any, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const userId = (req as any).user?.sub ?? '';
    if (!userId) return reply.status(401).send({ error: 'Authenticated user required' });
    try {
      const canAccess = await svc.checkUserAccess(tenantId, userId, req.params.id);
      reply.send({ canAccess });
    } catch (err) {
      handleError(err, reply);
    }
  });
}

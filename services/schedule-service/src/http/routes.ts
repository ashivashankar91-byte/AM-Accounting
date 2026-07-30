import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { asTenantId, authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { ScheduleApplicationService } from '../application/schedule-service';
import { OpenItemService } from '../application/open-item-service';
import { TieOutService } from '../application/tie-out-service';
import { AgingService } from '../application/aging-service';
import { InvalidAgingBucketConfigError } from '../domain/aging';
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
  OpenItemNotFoundError,
  OpenItemClosedError,
  OverApplicationError,
  ApplicationNotFoundError,
  ApplicationAlreadyReversedError,
  InvalidApplicationAmountError,
  DuplicateApplicationError,
} from '../domain/errors';

// @wave S026: corrected from 401 to 400 to comply with CLAUDE.md rule #3
// ("Every API endpoint MUST require x-tenant-id header — return 400 if
// missing") — non-negotiable and repo-wide, not S026/S027-specific, so this
// fixes every route in this file, not just the new open-item/tie-out ones.
function requireTenantId(request: any, reply: any): string | null {
  const id = request.headers['x-tenant-id'] as string | undefined;
  if (!id || !id.trim()) {
    reply.status(400).send({ error: 'Missing required header: x-tenant-id' });
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
  } else if (err instanceof OpenItemNotFoundError || err instanceof ApplicationNotFoundError) {
    reply.status(404).send({ error: (err as Error).message });
  } else if (
    err instanceof OpenItemClosedError ||
    err instanceof OverApplicationError ||
    err instanceof ApplicationAlreadyReversedError ||
    err instanceof InvalidApplicationAmountError
  ) {
    reply.status(422).send({ error: (err as Error).message, code: (err as any).name });
  } else if (err instanceof DuplicateApplicationError) {
    reply.status(409).send({ error: (err as Error).message, code: (err as any).name });
  } else if (err instanceof InvalidAgingBucketConfigError) {
    reply.status(422).send({ error: (err as Error).message, code: (err as any).name });
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
  const openItemSvc = container.resolve(OpenItemService);
  const tieOutSvc = container.resolve(TieOutService);
  const agingSvc = container.resolve(AgingService);
  const authzClient = container.resolve<AuthzClient>('AuthzClient');
  const requirePermission = createAuthzGuard(authzClient, { getTenantId: (req) => req.headers['x-tenant-id'] as string });

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

  // Schedule aging inquiry — used by ScheduleInquiry.tsx
  // Returns control-level aging summary for a given schedule
  app.get('/api/v1/schedules/aging', async (req, reply) => {
    const tenantId = requireTenantId(req, reply);
    if (!tenantId) return;
    const prisma = container.resolve<any>('PrismaClient');
    const q = req.query as any;

    // Control search mode (ControlPickerPopup uses ?search=...)
    if (q.search) {
      const rows = await prisma.scheduleDetail.findMany({
        where: {
          tenantId,
          controlNumber: { contains: q.search, mode: 'insensitive' },
        },
        select: { controlNumber: true, description: true },
        distinct: ['controlNumber'],
        take: 50,
      }).catch(() => []);
      const controls = (rows as any[]).map((r: any) => ({
        controlNum: r.controlNumber,
        name: r.description ?? r.controlNumber,
        phone: '',
        street: '',
        city: '',
      }));
      return reply.send(controls);
    }

    // Aging mode: ?scheduleId=...&thruDate=...&hideZero=true
    if (!q.scheduleId) return reply.send([]);
    const thruDate = q.thruDate ? new Date(q.thruDate) : new Date();

    const details = await prisma.scheduleDetail.findMany({
      where: {
        tenantId,
        scheduleNumber: q.scheduleId.toString().padStart(2, '0').slice(0, 2),
        transactionDate: { lte: thruDate },
      },
      orderBy: [{ controlNumber: 'asc' }, { transactionDate: 'asc' }],
    }).catch(() => []);

    // Group by controlNumber
    const grouped = new Map<string, any>();
    const now = new Date();
    for (const d of details as any[]) {
      const ctrl = d.controlNumber;
      if (!grouped.has(ctrl)) {
        grouped.set(ctrl, { controlNum: ctrl, description: d.description ?? ctrl, ageDays: 0, amount: 0 });
      }
      const row = grouped.get(ctrl)!;
      row.amount += Number(d.amount ?? 0);
      const txDate = d.transactionDate ? new Date(d.transactionDate) : now;
      const age = Math.floor((now.getTime() - txDate.getTime()) / 86400000);
      if (age > row.ageDays) row.ageDays = age;
    }

    let rows = Array.from(grouped.values());
    if (q.hideZero === 'true') rows = rows.filter((r) => r.amount !== 0);
    return reply.send(rows);
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

  // ---------------------------------------------------------------------------
  // S026 — Schedule Open-Item Core
  // ---------------------------------------------------------------------------

  const ManualApplySchema = z.object({
    amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
    idempotencyKey: z.string().min(1),
    note: z.string().max(500).optional(),
  });

  const ReverseApplicationSchema = z.object({
    note: z.string().max(500).optional(),
  });

  app.get(
    '/api/v1/schedules/:id/open-items',
    { preHandler: requirePermission('schedule.open_item.view') },
    async (req: any, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const q = req.query as any;
      try {
        const items = await openItemSvc.listOpenItems(tenantId, req.params.id, {
          controlNumber: q.controlNumber,
          status: q.status,
          glAccountNumber: q.glAccountNumber,
          asOfDate: q.asOfDate ? new Date(q.asOfDate) : undefined,
        });
        reply.send(items);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  app.get(
    '/api/v1/schedules/:id/open-items/:itemId',
    { preHandler: requirePermission('schedule.open_item.view') },
    async (req: any, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      try {
        const item = await openItemSvc.getOpenItem(tenantId, req.params.itemId);
        reply.send(item);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  app.post(
    '/api/v1/schedules/:id/open-items/:itemId/apply',
    { preHandler: requirePermission('schedule.open_item.apply') },
    async (req: any, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const body = ManualApplySchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
      }
      try {
        const userId = (req as any).user?.sub ?? 'unknown';
        const application = await openItemSvc.applyManual(tenantId, req.params.itemId, {
          amount: body.data.amount,
          idempotencyKey: body.data.idempotencyKey,
          note: body.data.note,
          appliedBy: userId,
        });
        reply.status(201).send(application);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  app.post(
    '/api/v1/schedules/:id/open-items/applications/:applicationId/reverse',
    { preHandler: requirePermission('schedule.open_item.reverse') },
    async (req: any, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const body = ReverseApplicationSchema.safeParse(req.body ?? {});
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
      }
      try {
        const userId = (req as any).user?.sub ?? 'unknown';
        const reversal = await openItemSvc.reverseApplication(
          tenantId,
          req.params.applicationId,
          userId,
          body.data.note,
        );
        reply.status(201).send(reversal);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // S026 — nightly GL-to-schedule tie-out
  // ---------------------------------------------------------------------------

  app.get(
    '/api/v1/schedules/tie-outs',
    { preHandler: requirePermission('schedule.tie_out.view') },
    async (req, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const q = req.query as any;
      try {
        const rows = q.latest === 'true'
          ? await tieOutSvc.getLatestRun(tenantId)
          : await tieOutSvc.listTieOuts(tenantId, {
              scheduleNumber: q.scheduleNumber,
              status: q.status,
              asOfDate: q.asOfDate ? new Date(q.asOfDate) : undefined,
            });
        reply.send(rows);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  app.post(
    '/api/v1/schedules/tie-outs/run',
    { preHandler: requirePermission('schedule.tie_out.run') },
    async (req, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const body = (req.body ?? {}) as { asOfDate?: string };
      try {
        const userId = (req as any).user?.sub ?? 'unknown';
        const asOfDate = body.asOfDate ? new Date(body.asOfDate) : new Date();
        const result = await tieOutSvc.runTieOut(tenantId, asOfDate, userId);
        reply.status(201).send(result);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // S027 — Schedule Aging Engine
  // ---------------------------------------------------------------------------

  const AgingQuerySchema = z.object({
    asOfDate: z.string().optional(),
    controlNumber: z.string().optional(),
    glAccountNumber: z.string().optional(),
  });

  app.get(
    '/api/v1/schedules/:id/aging-report',
    { preHandler: requirePermission('schedule.aging.view') },
    async (req: any, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const q = AgingQuerySchema.safeParse(req.query);
      if (!q.success) {
        return reply.status(400).send({ error: 'Invalid query parameters', issues: q.error.issues });
      }
      try {
        const report = await agingSvc.getAgingReport(tenantId, {
          scheduleNumber: req.params.id,
          controlNumber: q.data.controlNumber,
          glAccountNumber: q.data.glAccountNumber,
          asOfDate: q.data.asOfDate ? new Date(q.data.asOfDate) : undefined,
        });
        reply.send(report);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  // Cross-schedule aging — same report shape, no scheduleNumber filter.
  app.get(
    '/api/v1/schedules/aging-report',
    { preHandler: requirePermission('schedule.aging.view') },
    async (req, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const ExtQuerySchema = AgingQuerySchema.extend({ scheduleNumber: z.string().optional() });
      const q = ExtQuerySchema.safeParse(req.query);
      if (!q.success) {
        return reply.status(400).send({ error: 'Invalid query parameters', issues: q.error.issues });
      }
      try {
        const report = await agingSvc.getAgingReport(tenantId, {
          scheduleNumber: q.data.scheduleNumber,
          controlNumber: q.data.controlNumber,
          glAccountNumber: q.data.glAccountNumber,
          asOfDate: q.data.asOfDate ? new Date(q.data.asOfDate) : undefined,
        });
        reply.send(report);
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  app.get(
    '/api/v1/schedules/aging-bucket-config',
    { preHandler: requirePermission('schedule.aging.view') },
    async (req, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      try {
        const buckets = await agingSvc.getBucketConfig(tenantId);
        reply.send({ buckets });
      } catch (err) {
        handleError(err, reply);
      }
    },
  );

  const SetBucketConfigSchema = z.object({
    buckets: z.array(z.object({
      label: z.string().min(1),
      upperBoundDays: z.number().nullable(),
    })).min(1),
  });

  app.put(
    '/api/v1/schedules/aging-bucket-config',
    { preHandler: requirePermission('schedule.aging.config') },
    async (req: any, reply) => {
      const tenantId = requireTenantId(req, reply);
      if (!tenantId) return;
      const body = SetBucketConfigSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid request body', issues: body.error.issues });
      }
      try {
        const userId = (req as any).user?.sub ?? 'unknown';
        const buckets = await agingSvc.setBucketConfig(tenantId, body.data.buckets, userId);
        reply.send({ buckets });
      } catch (err) {
        handleError(err, reply);
      }
    },
  );
}

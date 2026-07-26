import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import {
  FiscalCalendarService,
  FiscalValidationError,
  CalendarLockedError,
  FiscalYearOverlapError,
  CalendarNotFoundError,
  PeriodNotFoundError,
} from '../application/fiscal-service';

// ── Tenant scoping ─────────────────────────────────────────────────────────────

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

// ── AuthzPort stub (deny-by-default static role map; S207 replacement) ──────────
// Permission strings per packet §2: fiscal.calendar.view, fiscal.calendar.manage.

export const FISCAL_PERMISSIONS = {
  VIEW: 'fiscal.calendar.view',
  MANAGE: 'fiscal.calendar.manage',
} as const;

const ROLE_PERMISSIONS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set([FISCAL_PERMISSIONS.VIEW, FISCAL_PERMISSIONS.MANAGE]),
  CONTROLLER: new Set([FISCAL_PERMISSIONS.VIEW, FISCAL_PERMISSIONS.MANAGE]),
  ACCOUNTANT: new Set([FISCAL_PERMISSIONS.VIEW]),
};

export function requireFiscalPermission(permission: string) {
  return async function checkPermission(request: any, reply: any) {
    const role = request.user?.role as string | undefined;
    const granted = role ? (ROLE_PERMISSIONS[role] ?? new Set<string>()) : new Set<string>();
    if (!granted.has(permission)) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: `Missing required permission: ${permission}`,
      });
    }
  };
}

function handleError(error: unknown, reply: any) {
  if (error instanceof FiscalValidationError || error instanceof CalendarLockedError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof FiscalYearOverlapError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof CalendarNotFoundError || error instanceof PeriodNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  if ((error as any)?.statusCode === 400) {
    return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  }
  throw error;
}

// ── Zod ────────────────────────────────────────────────────────────────────────

const DefineSchema = z.object({
  fyStartMonth: z.number().int().min(1).max(12),
  structure: z.enum(['TWELVE', 'TWELVE_PLUS_13TH']),
  actor: z.string().min(1).optional(),
});

const GenerateSchema = z.object({
  fiscalYear: z.number().int().min(1900).max(9999),
  actor: z.string().min(1).optional(),
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Routes (registered under /api/v1/fiscal) ────────────────────────────────────

export async function fiscalRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<FiscalCalendarService>('FiscalCalendarService');

  // POST /fiscal/entities/:entityId/fiscal-calendar — define/update calendar.
  app.post(
    '/entities/:entityId/fiscal-calendar',
    { preHandler: requireFiscalPermission(FISCAL_PERMISSIONS.MANAGE) },
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { entityId } = request.params as { entityId: string };
      try {
        const body = DefineSchema.parse(request.body);
        const result = await svc.defineCalendar({
          tenantId,
          entityId,
          fyStartMonth: body.fyStartMonth,
          structure: body.structure,
          actor: body.actor ?? (request.user?.sub as string | undefined) ?? 'system',
        });
        return reply.status(result.created ? 201 : 200).send(result.calendar);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /fiscal/entities/:entityId/fiscal-calendar — read calendar.
  app.get(
    '/entities/:entityId/fiscal-calendar',
    { preHandler: requireFiscalPermission(FISCAL_PERMISSIONS.VIEW) },
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { entityId } = request.params as { entityId: string };
      try {
        return reply.send(await svc.getCalendar(tenantId, entityId));
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /fiscal/entities/:entityId/fiscal-calendar/years — :generateYear.
  app.post(
    '/entities/:entityId/fiscal-calendar/years',
    { preHandler: requireFiscalPermission(FISCAL_PERMISSIONS.MANAGE) },
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { entityId } = request.params as { entityId: string };
      try {
        const body = GenerateSchema.parse(request.body);
        const result = await svc.generateYear({
          tenantId,
          entityId,
          fiscalYear: body.fiscalYear,
          actor: body.actor ?? (request.user?.sub as string | undefined) ?? 'system',
        });
        return reply.status(201).send({
          fiscalYear: body.fiscalYear,
          periodCount: result.periodCount,
          periods: result.periods,
        });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /fiscal/entities/:entityId/periods?fy= — list generated periods.
  app.get(
    '/entities/:entityId/periods',
    { preHandler: requireFiscalPermission(FISCAL_PERMISSIONS.VIEW) },
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { entityId } = request.params as { entityId: string };
      const { fy } = request.query as { fy?: string };
      try {
        const fiscalYear = fy !== undefined ? Number(fy) : undefined;
        return reply.send({ periods: await svc.listPeriods(tenantId, entityId, fiscalYear) });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /fiscal/entities/:entityId/periods/resolve?date=YYYY-MM-DD — BR208-5.
  app.get(
    '/entities/:entityId/periods/resolve',
    { preHandler: requireFiscalPermission(FISCAL_PERMISSIONS.VIEW) },
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { entityId } = request.params as { entityId: string };
      const { date } = request.query as { date?: string };
      try {
        if (!date || !DATE_RE.test(date)) {
          return reply.status(400).send({
            error: 'BAD_REQUEST',
            message: 'query param "date" (YYYY-MM-DD) is required',
          });
        }
        const period = await svc.resolve(tenantId, entityId, date);
        return reply.send({
          periodCode: period.code,
          periodNumber: period.periodNumber,
          fiscalYear: period.fiscalYear,
          status: period.status,
          adjustmentsOnly: period.adjustmentsOnly,
        });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}

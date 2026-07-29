import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  RecurringTemplateService,
  TemplateInputError,
  TemplateNotFoundError,
  TemplateLineValidationError,
  TemplateUnbalancedError,
  DuplicateTemplateCodeError,
  RtSourceNotBootstrappedError,
  TemplatePeriodNotFoundError,
  PeriodNotEligibleError,
} from '../application/recurring-template-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

// ── Authorization (deny-by-default, centralized through real S207) ────────────
// Per PROPOSED_CONTRACT_V1 (P01_STORY_CONTRACTS.md S032): je.template.manage
// (CRUD/activate) and je.template.generate (the :generate ceremony).
export const TEMPLATE_PERMISSIONS = {
  MANAGE: 'je.template.manage',
  GENERATE: 'je.template.generate',
  VIEW: 'je.template.view',
} as const;

export function requireTemplatePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

/** Any role holding at least one template permission may read (deny-by-default). */
function requireTemplateReader() {
  return async function checkReader(request: any, reply: any) {
    const userId = request.user?.sub as string | undefined;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'No authenticated user on request' });
    }
    const tenantId = getTenantId(request);
    const client = container.resolve<AuthzClient>('AuthzClient');
    const perms = [TEMPLATE_PERMISSIONS.MANAGE, TEMPLATE_PERMISSIONS.GENERATE, TEMPLATE_PERMISSIONS.VIEW];
    const results = await Promise.all(perms.map((permissionKey) => client.check({ userId, permissionKey, scope: { tenantId } })));
    if (!results.some((r) => r.allow)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'No recurring-template permissions' });
    }
  };
}

function actorOf(request: any) {
  return { tenantId: getTenantId(request), userId: (request.user?.sub as string | undefined) ?? 'system' };
}

function handleError(error: unknown, reply: any) {
  if (
    error instanceof TemplateInputError ||
    error instanceof TemplateLineValidationError ||
    error instanceof TemplateUnbalancedError
  ) {
    return reply.status(422).send({
      error: (error as any).code,
      message: error.message,
      ...(error instanceof TemplateLineValidationError ? { violations: error.violations } : {}),
      ...(error instanceof TemplateUnbalancedError ? { totalDr: error.totalDr, totalCr: error.totalCr } : {}),
    });
  }
  if (error instanceof PeriodNotEligibleError) {
    return reply.status(422).send({
      error: error.code,
      message: error.message,
      periodCode: error.periodCode,
      periodStatus: error.periodStatus,
      reason: error.reason,
    });
  }
  if (error instanceof DuplicateTemplateCodeError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof TemplateNotFoundError || error instanceof TemplatePeriodNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof RtSourceNotBootstrappedError) {
    return reply.status(503).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  if ((error as any)?.statusCode === 400) {
    return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  }
  throw error;
}

const LineSchema = z.object({
  accountId: z.string().min(1),
  accountNumber: z.string().nullable().optional(),
  storeId: z.string().min(1),
  deptCode: z.string().nullable().optional(),
  controlNumber: z.string().nullable().optional(),
  applyNumber: z.string().nullable().optional(),
  dr: z.union([z.number(), z.string()]).nullable().optional(),
  cr: z.union([z.number(), z.string()]).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
});

const CreateSchema = z.object({
  entityId: z.string().min(1),
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  autoReverse: z.boolean().optional(),
  lines: z.array(LineSchema).min(2),
});

const UpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  autoReverse: z.boolean().optional(),
  lines: z.array(LineSchema).min(2).optional(),
});

const GenerateSchema = z.object({
  entityId: z.string().min(1),
  periodId: z.string().min(1),
  templateIds: z.union([z.array(z.string()), z.literal('ALL')]).optional(),
});

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────
export async function recurringTemplateRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<RecurringTemplateService>('RecurringTemplateService');

  // POST /journal-templates — create (BR032-1: balanced + shape-valid at save).
  app.post('/journal-templates', { preHandler: requireTemplatePermission(TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateSchema.parse(request.body ?? {});
      const row = await svc.create(tenantId, body, actorOf(request));
      return reply.status(201).send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /journal-templates?entity=&active=
  app.get('/journal-templates', { preHandler: requireTemplateReader() }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { entity, active } = request.query as { entity?: string; active?: string };
      const rows = await svc.list(tenantId, entity, active !== undefined ? { active: active === 'true' } : undefined);
      return reply.send({ templates: rows });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /journal-templates/:id
  app.get('/journal-templates/:id', { preHandler: requireTemplateReader() }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.get(tenantId, id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PUT /journal-templates/:id — BR032-7: version bumps; past generations unaffected.
  app.put('/journal-templates/:id', { preHandler: requireTemplatePermission(TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = UpdateSchema.parse(request.body ?? {});
      const row = await svc.update(tenantId, id, body, actorOf(request));
      return reply.send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /journal-templates/:id/activate | /deactivate
  app.post('/journal-templates/:id/activate', { preHandler: requireTemplatePermission(TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.setActive(tenantId, id, true, actorOf(request)));
    } catch (err) {
      return handleError(err, reply);
    }
  });
  app.post('/journal-templates/:id/deactivate', { preHandler: requireTemplatePermission(TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.setActive(tenantId, id, false, actorOf(request)));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /journal-templates:generate — the manual ceremony (BLK-21: the only
  // trigger; no scheduler route exists anywhere in this service).
  app.post('/journal-templates:generate', { preHandler: requireTemplatePermission(TEMPLATE_PERMISSIONS.GENERATE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = GenerateSchema.parse(request.body ?? {});
      const result = await svc.generate(tenantId, body, actorOf(request));
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

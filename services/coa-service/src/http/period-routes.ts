import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  PeriodService,
  PeriodNotFoundError,
  InvalidTransitionError,
  MaxOpenReachedError,
} from '../application/period-service';

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

// ── Authorization (deny-by-default, centralized through real S207) ────────────
// Permission strings per packet §2: fiscal.period.view, fiscal.period.open.

export const PERIOD_PERMISSIONS = {
  VIEW: 'fiscal.period.view',
  OPEN: 'fiscal.period.open',
} as const;

// R0 Stabilization Phase 3: centralized through the real S207 AuthzService
// (see account-routes.ts header comment for full rationale).
export function requirePeriodPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof InvalidTransitionError || error instanceof MaxOpenReachedError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof PeriodNotFoundError) {
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

const OpenSchema = z.object({
  confirm: z.boolean().optional(),
  actor: z.string().min(1).optional(),
});

// ── Routes (registered under /api/v1/fiscal) ────────────────────────────────────

export async function periodRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<PeriodService>('PeriodService');

  // GET /fiscal/periods?entity= — status board.
  app.get('/periods', { preHandler: requirePeriodPermission(PERIOD_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const { entity } = request.query as { entity?: string };
    try {
      if (!entity) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'query param "entity" is required' });
      }
      return reply.send({ board: await svc.board(tenantId, entity) });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /fiscal/periods/:id/eligibility — postability + reason.
  app.get(
    '/periods/:id/eligibility',
    { preHandler: requirePeriodPermission(PERIOD_PERMISSIONS.VIEW) },
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      try {
        return reply.send(await svc.eligibility(tenantId, id));
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /fiscal/periods/:id/open — FUTURE->OPEN (:open).
  app.post(
    '/periods/:id/open',
    { preHandler: requirePeriodPermission(PERIOD_PERMISSIONS.OPEN) },
    async (request, reply) => {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      try {
        const body = OpenSchema.parse(request.body ?? {});
        const result = await svc.open({
          tenantId,
          periodId: id,
          actor: body.actor ?? (request.user?.sub as string | undefined) ?? 'system',
          confirm: body.confirm,
        });
        // Skip-open warning: no state change, ask the caller to confirm.
        if (result.requiresConfirmation) {
          return reply.status(200).send({
            opened: false,
            requiresConfirmation: true,
            warning: result.warning,
            skippedPeriods: result.skippedPeriods,
            message: `Opening this period skips earlier unopened period(s): ${result.skippedPeriods?.join(', ')}. Re-submit with confirm=true.`,
          });
        }
        return reply.status(200).send({
          opened: result.opened,
          status: result.status,
          skippedPeriods: result.skippedPeriods,
        });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}

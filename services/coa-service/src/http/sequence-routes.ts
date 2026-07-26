import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { SequenceService, SequenceValidationError } from '../application/sequence-service';

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
export const SEQUENCE_PERMISSIONS = {
  GAP_REPORT: 'je.gap_report.view',
  // allocate/logGap are internal to the posting path (S013/S214); guarded by a
  // dedicated permission so the temporary HTTP handles are not publicly usable.
  ALLOCATE: 'je.sequence.allocate',
} as const;

// R0 Stabilization Phase 3: centralized through the real S207 AuthzService
// (see account-routes.ts header comment for full rationale).
export function requireSequencePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof SequenceValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  if ((error as any)?.statusCode === 400) {
    return reply.status(400).send({ error: 'BAD_REQUEST', message: (error as any).message });
  }
  throw error;
}

const AllocateSchema = z.object({
  sourceCode: z.string().min(1),
  entityId: z.string().min(1),
  periodCode: z.string().min(1),
});

const LogGapSchema = z.object({
  sourceCode: z.string().min(1),
  entityId: z.string().min(1),
  periodCode: z.string().min(1),
  seq: z.number().int().min(1),
  reason: z.string().min(1),
  actor: z.string().min(1).optional(),
});

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────────
export async function sequenceRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<SequenceService>('SequenceService');
  const actorOf = (request: any, body: any) =>
    body?.actor ?? (request.user?.sub as string | undefined) ?? 'system';

  // POST /journal-sequences/allocate — internal atomic allocation primitive (S013/S214 consumer).
  app.post('/journal-sequences/allocate', { preHandler: requireSequencePermission(SEQUENCE_PERMISSIONS.ALLOCATE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = AllocateSchema.parse(request.body ?? {});
      const result = await svc.allocate({
        tenantId,
        sourceCode: body.sourceCode,
        entityId: body.entityId,
        periodCode: body.periodCode,
      });
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /journal-sequences/log-gap — record a gap for a failed/aborted post (BR213-3).
  app.post('/journal-sequences/log-gap', { preHandler: requireSequencePermission(SEQUENCE_PERMISSIONS.ALLOCATE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = LogGapSchema.parse(request.body ?? {});
      const row = await svc.logGap({
        tenantId,
        sourceCode: body.sourceCode,
        entityId: body.entityId,
        periodCode: body.periodCode,
        seq: body.seq,
        reason: body.reason,
        actor: actorOf(request, body),
      });
      return reply.status(201).send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /journals/gap-report?entity=&period= — gap report (perm je.gap_report.view).
  app.get('/journals/gap-report', { preHandler: requireSequencePermission(SEQUENCE_PERMISSIONS.GAP_REPORT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as { entity?: string; period?: string };
      const rows = await svc.gapReport(tenantId, { entityId: q.entity, periodCode: q.period });
      return reply.status(200).send(rows);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

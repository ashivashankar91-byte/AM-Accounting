import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  PostingService,
  PostingInputError,
  PostingViolationError,
  AnalysisTagViolationError,
} from '../application/posting-service';
import { JournalViewService, JournalNotFoundError } from '../application/journal-view-service';
import {
  ReversalService,
  ReversalReasonRequiredError,
  ReversalTargetNotFoundError,
  AlreadyReversedError,
  ClosedTargetPeriodError,
} from '../application/reversal-service';

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
export const JE_PERMISSIONS = {
  POST: 'je.post',
  VIEW: 'je.view',
  REVERSE: 'je.reverse',
} as const;

// R0 Stabilization Phase 3: centralized through the real S207 AuthzService
// (see account-routes.ts header comment for full rationale). Resolved fresh
// on every call (not cached at module scope) because draft-routes.ts imports
// and calls this both at route-registration time (preHandler) and inline
// mid-request-handler (postDraft's validate-first path) — the latter needs a
// plain callable factory, not one bound to a single app-registration closure.
export function requireJePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof JournalNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message, suggestion: error.suggestion });
  }
  if (error instanceof ReversalTargetNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof ReversalReasonRequiredError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof AlreadyReversedError) {
    return reply.status(409).send({ error: error.code, message: error.message, reversedBy: error.reversedBy, reversalNumber: error.reversalNumber });
  }
  if (error instanceof ClosedTargetPeriodError) {
    return reply.status(422).send({ error: error.code, message: error.message, targetPeriod: error.targetPeriod, eligiblePeriods: error.eligiblePeriods });
  }
  if (error instanceof PostingViolationError) {
    return reply.status(422).send({ error: error.code, message: error.message, violations: error.violations });
  }
  if (error instanceof AnalysisTagViolationError) {
    return reply.status(422).send({ error: error.code, message: error.message, violations: error.violations });
  }
  if (error instanceof PostingInputError) {
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

const LineSchema = z.object({
  accountId: z.string().min(1),
  storeId: z.string().min(1),
  deptCode: z.string().nullable().optional(),
  controlNumber: z.string().nullable().optional(),
  applyNumber: z.string().nullable().optional(),
  dr: z.union([z.number(), z.string()]).nullable().optional(),
  cr: z.union([z.number(), z.string()]).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  // S011 P01-SCR-05 — optional line-level analysis tags, validated fail-closed
  // (cap/active/type-match, BR011-1/BR011-4) before the journal is posted.
  analysisTags: z
    .array(z.object({ typeId: z.string().min(1), valueId: z.string().min(1) }))
    .nullable()
    .optional(),
});

const PostSchema = z.object({
  entityId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  sourceCode: z.string().min(1),
  memo: z.string().max(500).nullable().optional(),
  idempotencyKey: z.string().min(1),
  lines: z.array(LineSchema).min(1),
});

const ReverseSchema = z.object({
  targetPeriod: z.string().nullable().optional(),
  reason: z.string().max(500).optional(),
});

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────────
export async function journalRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<PostingService>('PostingService');
  const viewSvc = container.resolve<JournalViewService>('JournalViewService');
  const reversalSvc = container.resolve<ReversalService>('ReversalService');

  // POST /journals — BR013 balanced posting (the single point of ledger truth).
  app.post('/journals', { preHandler: requireJePermission(JE_PERMISSIONS.POST) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = PostSchema.parse(request.body ?? {});
      const result = await svc.post({
        tenantId,
        entityId: body.entityId,
        date: body.date,
        sourceCode: body.sourceCode,
        memo: body.memo ?? null,
        idempotencyKey: body.idempotencyKey,
        callerClass: 'MANUAL',
        postedBy: (request.user?.sub as string | undefined) ?? 'system',
        lines: body.lines,
      });
      // BR013-6 — a duplicate idempotencyKey returns the original with 200.
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /journals/:number — S217 read-only view (header, lines, source, poster,
  // timestamps, attachments, reversal linkage). Masks PII for masked roles (S004A).
  app.get('/journals/:number', { preHandler: requireJePermission(JE_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const journalNumber = (request.params as any).number as string;
      const view = await viewSvc.view(tenantId, journalNumber, {
        userId: (request.user?.sub as string | undefined) ?? 'system',
        role: request.user?.role as string | undefined,
      });
      return reply.status(200).send(view);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /journals/:id:reverse — S218 reverse a posted JE (colon-action dispatcher).
  // Mirrored lines through the single posting door, linked both ways, reason required.
  app.post('/journals/:target', { preHandler: requireJePermission(JE_PERMISSIONS.REVERSE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const target = (request.params as any).target as string;
      const sep = target.lastIndexOf(':');
      const id = sep > 0 ? target.slice(0, sep) : target;
      const action = sep > 0 ? target.slice(sep + 1) : '';
      if (action !== 'reverse') {
        return reply.status(404).send({ error: 'NOT_FOUND', message: `Unknown journal action: ${action || '(none)'}` });
      }
      const body = ReverseSchema.parse(request.body ?? {});
      const result = await reversalSvc.reverse(
        tenantId,
        id,
        { targetPeriod: body.targetPeriod ?? null, reason: body.reason ?? '' },
        { userId: (request.user?.sub as string | undefined) ?? 'system' },
      );
      return reply.status(201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  DraftService,
  DraftInputError,
  DraftNotFoundError,
  DraftForbiddenError,
  DraftNotEditableError,
  AttachmentRejectedError,
  DraftValidationBlockedError,
  DraftEngineUnavailableError,
  PostingModeGateError,
  DraftPostValidationError,
  DraftReverseOnlyError,
  DraftVoidReasonRequiredError,
  AdjustingEntryPermissionError,
  AdjustingEntryReasonRequiredError,
} from '../application/draft-service';
import { PostingViolationError, AnalysisTagViolationError } from '../application/posting-service';
import { requireJePermission, JE_PERMISSIONS } from './journal-routes';

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
export const JE_DRAFT_PERMISSIONS = {
  CREATE: 'je.draft.create',
  EDIT: 'je.draft.edit',
  VIEW_ALL: 'je.draft.view_all',
  VOID: 'je.draft.void',
  VOID_ANY: 'je.draft.void.any',
  MARK_ADJUSTING: 'fiscal.je.mark_adjusting',
} as const;

// R0 Stabilization Phase 3: centralized through the real S207 AuthzService
// (see account-routes.ts header comment for full rationale). Unlike the other
// 8 coa-service route files, this one also derived business-logic flags
// (canViewAll/canVoidOwn/canVoidAny, passed into DraftService) directly from
// the local role->Set map — actorOf() below now resolves those the same way
// the route guard does (real permission checks), not a duplicated map.

export function requireJeDraftPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

/** Any role holding at least one draft permission may list/view (deny-by-default). */
function requireDraftReader() {
  return async function checkReader(request: any, reply: any) {
    const userId = request.user?.sub as string | undefined;
    if (!userId) {
      return reply.status(401).send({ error: 'UNAUTHENTICATED', message: 'No authenticated user on request' });
    }
    const tenantId = getTenantId(request);
    const client = container.resolve<AuthzClient>('AuthzClient');
    const perms = [
      JE_DRAFT_PERMISSIONS.CREATE, JE_DRAFT_PERMISSIONS.EDIT, JE_DRAFT_PERMISSIONS.VIEW_ALL,
      JE_DRAFT_PERMISSIONS.VOID, JE_DRAFT_PERMISSIONS.VOID_ANY,
    ];
    const results = await Promise.all(
      perms.map((permissionKey) => client.check({ userId, permissionKey, scope: { tenantId } })),
    );
    if (!results.some((r) => r.allow)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'No draft permissions' });
    }
  };
}

async function actorOf(request: any, tenantId: string) {
  const client = container.resolve<AuthzClient>('AuthzClient');
  const userId = (request.user?.sub as string | undefined) ?? 'system';
  const [viewAll, voidOwn, voidAny, markAdjusting] = await Promise.all([
    client.check({ userId, permissionKey: JE_DRAFT_PERMISSIONS.VIEW_ALL, scope: { tenantId } }),
    client.check({ userId, permissionKey: JE_DRAFT_PERMISSIONS.VOID, scope: { tenantId } }),
    client.check({ userId, permissionKey: JE_DRAFT_PERMISSIONS.VOID_ANY, scope: { tenantId } }),
    client.check({ userId, permissionKey: JE_DRAFT_PERMISSIONS.MARK_ADJUSTING, scope: { tenantId } }),
  ]);
  return {
    tenantId,
    userId,
    canViewAll: viewAll.allow,
    canVoidOwn: voidOwn.allow,
    canVoidAny: voidAny.allow,
    canMarkAdjusting: markAdjusting.allow,
  };
}

function handleError(error: unknown, reply: any) {
  if (
    error instanceof DraftNotFoundError ||
    error instanceof DraftForbiddenError ||
    error instanceof DraftNotEditableError ||
    error instanceof AttachmentRejectedError ||
    error instanceof DraftInputError ||
    error instanceof DraftValidationBlockedError ||
    error instanceof DraftEngineUnavailableError ||
    error instanceof PostingModeGateError ||
    error instanceof DraftReverseOnlyError ||
    error instanceof DraftVoidReasonRequiredError ||
    error instanceof AdjustingEntryPermissionError ||
    error instanceof AdjustingEntryReasonRequiredError
  ) {
    return reply.status((error as any).status).send({ error: (error as any).code, message: (error as any).message });
  }
  if (error instanceof DraftPostValidationError) {
    // §3 negative — surface failures in the same S215 shape the accountant fixes.
    return reply.status(error.status).send({
      error: error.code,
      message: error.message,
      validation: error.validation,
    });
  }
  if (error instanceof PostingViolationError) {
    return reply.status(error.status).send({ error: error.code, message: error.message, violations: error.violations });
  }
  if (error instanceof AnalysisTagViolationError) {
    // S011 — tag rejection at the S013 door (cap/inactive/unknown/duplicate).
    return reply.status(error.status).send({ error: error.code, message: error.message, violations: error.violations });
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
  accountId: z.string().nullable().optional(),
  accountNumber: z.string().nullable().optional(),
  storeId: z.string().nullable().optional(),
  deptCode: z.string().nullable().optional(),
  controlNumber: z.string().nullable().optional(),
  applyNumber: z.string().nullable().optional(),
  dr: z.union([z.number(), z.string()]).nullable().optional(),
  cr: z.union([z.number(), z.string()]).nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  // S011 P01-SCR-05 — line-level analysis tags; validated (cap/active/type
  // match) only at post time (BR011-1/BR011-4). Draft save accepts ANY shape
  // here per BR214-1 ("save in any state").
  analysisTags: z
    .array(z.object({ typeId: z.string().min(1), valueId: z.string().min(1) }))
    .nullable()
    .optional(),
});

// BR214-1 — every field optional so ANY state saves.
const DraftSchema = z.object({
  entityId: z.string().nullable().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sourceCode: z.string().nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  lines: z.array(LineSchema).optional(),
  // S008 — per-draft adjusting-entry attribute. Permission (fiscal.je.mark_adjusting)
  // and mandatory reason/correctionRef are enforced in DraftService, not here.
  isAdjusting: z.boolean().nullable().optional(),
  adjustingReason: z.string().max(500).nullable().optional(),
  adjustingCorrectionRef: z.string().max(120).nullable().optional(),
});

const AttachmentSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative(),
});

const VoidSchema = z.object({
  reason: z.string().max(500).nullable().optional(),
});

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────────
export async function draftRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<DraftService>('DraftService');

  // POST — create/save a draft in ANY state (BR214-1).
  app.post('/manual-journals/drafts', { preHandler: requireJeDraftPermission(JE_DRAFT_PERMISSIONS.CREATE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = DraftSchema.parse(request.body ?? {});
      const preparer = (request.user?.sub as string) ?? 'system';
      const actor = await actorOf(request, tenantId);
      const draft = await svc.create({ tenantId, preparer, canMarkAdjusting: actor.canMarkAdjusting, ...body });
      return reply.status(201).send({ draftId: draft.id, status: draft.status, version: draft.version });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET list — scoped to preparer unless view_all (BR214-2).
  app.get('/manual-journals/drafts', { preHandler: requireDraftReader() }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const drafts = await svc.list(await actorOf(request, tenantId));
      return reply.send({ drafts });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET one — full-fidelity reload with attachments (BR214-1/2).
  app.get('/manual-journals/drafts/:id', { preHandler: requireDraftReader() }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const draft = await svc.get(id, await actorOf(request, tenantId));
      return reply.send(draft);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PUT — full replace of an editable draft (BR214-1; history retained BR214-3).
  app.put('/manual-journals/drafts/:id', { preHandler: requireJeDraftPermission(JE_DRAFT_PERMISSIONS.EDIT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = DraftSchema.parse(request.body ?? {});
      const draft = await svc.update(id, body, await actorOf(request, tenantId));
      return reply.send({ draftId: draft.id, status: draft.status, version: draft.version });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST attachment — bind at the draft (BR214-4, basic upload).
  app.post('/manual-journals/drafts/:id/attachments', { preHandler: requireJeDraftPermission(JE_DRAFT_PERMISSIONS.EDIT) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = AttachmentSchema.parse(request.body ?? {});
      const att = await svc.addAttachment(id, body, await actorOf(request, tenantId));
      return reply.status(201).send({ attachmentId: att.id, fileName: att.fileName, sizeBytes: att.sizeBytes });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST resource:action — colon-action verbs on a draft (find-my-way keeps the
  // literal ':action' inside a single path segment, so we capture it and dispatch).
  // Each action gates on its OWN permission (validate=je.draft.edit, post=je.post).
  // S219 :void extends this dispatcher. Baseline reader guard prevents anon use.
  app.post('/manual-journals/drafts/:target', { preHandler: requireDraftReader() }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const target = (request.params as { target: string }).target;
      const sep = target.lastIndexOf(':');
      if (sep < 0) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Unknown draft action' });
      }
      const id = target.slice(0, sep);
      const action = target.slice(sep + 1);
      const actor = await actorOf(request, tenantId);

      if (action === 'validate') {
        // je.validate is implied by je.draft.edit (S215).
        await requireJeDraftPermission(JE_DRAFT_PERMISSIONS.EDIT)(request, reply);
        if (reply.sent) return;
        const result = await svc.validate(id, actor); // S215
        return reply.status(200).send(result);
      }
      if (action === 'post') {
        // S216 — deliberate Post gated by je.post (deny-by-default AuthzPort stub).
        await requireJePermission(JE_PERMISSIONS.POST)(request, reply);
        if (reply.sent) return;
        const result = await svc.postDraft(id, actor); // S216
        return reply.status(201).send(result);
      }
      if (action === 'void') {
        // S219 — own void needs je.draft.void; voiding another preparer's draft
        // additionally requires je.draft.void.any and a non-empty reason.
        await requireJeDraftPermission(JE_DRAFT_PERMISSIONS.VOID)(request, reply);
        if (reply.sent) return;
        const body = VoidSchema.parse(request.body ?? {});
        const result = await svc.voidDraft(id, { reason: body.reason ?? null }, actor);
        return reply.status(200).send(result);
      }
      return reply.status(404).send({ error: 'NOT_FOUND', message: `Unknown draft action: ${action}` });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

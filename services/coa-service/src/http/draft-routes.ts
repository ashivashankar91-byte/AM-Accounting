import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
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
} from '../application/draft-service';
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

// ── AuthzPort stub (deny-by-default; S207 replacement) ──────────────────────────
export const JE_DRAFT_PERMISSIONS = {
  CREATE: 'je.draft.create',
  EDIT: 'je.draft.edit',
  VIEW_ALL: 'je.draft.view_all',
  VOID: 'je.draft.void',
  VOID_ANY: 'je.draft.void.any',
} as const;

const ROLE_PERMISSIONS: Record<string, ReadonlySet<string>> = {
  ADMIN: new Set([
    JE_DRAFT_PERMISSIONS.CREATE,
    JE_DRAFT_PERMISSIONS.EDIT,
    JE_DRAFT_PERMISSIONS.VIEW_ALL,
    JE_DRAFT_PERMISSIONS.VOID,
    JE_DRAFT_PERMISSIONS.VOID_ANY,
  ]),
  CONTROLLER: new Set([
    JE_DRAFT_PERMISSIONS.CREATE,
    JE_DRAFT_PERMISSIONS.EDIT,
    JE_DRAFT_PERMISSIONS.VIEW_ALL,
    JE_DRAFT_PERMISSIONS.VOID,
  ]),
  ACCOUNTANT: new Set([JE_DRAFT_PERMISSIONS.CREATE, JE_DRAFT_PERMISSIONS.EDIT, JE_DRAFT_PERMISSIONS.VOID]),
  CLERK: new Set([JE_DRAFT_PERMISSIONS.CREATE, JE_DRAFT_PERMISSIONS.EDIT, JE_DRAFT_PERMISSIONS.VOID]),
};

function grantedFor(role?: string): ReadonlySet<string> {
  return role ? (ROLE_PERMISSIONS[role] ?? new Set<string>()) : new Set<string>();
}

export function requireJeDraftPermission(permission: string) {
  return async function checkPermission(request: any, reply: any) {
    if (!grantedFor(request.user?.role as string | undefined).has(permission)) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: `Missing required permission: ${permission}` });
    }
  };
}

/** Any role holding at least one draft permission may list/view (deny-by-default). */
function requireDraftReader() {
  return async function checkReader(request: any, reply: any) {
    if (grantedFor(request.user?.role as string | undefined).size === 0) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'No draft permissions' });
    }
  };
}

function actorOf(request: any, tenantId: string) {
  const granted = grantedFor(request.user?.role as string | undefined);
  return {
    tenantId,
    userId: (request.user?.sub as string | undefined) ?? 'system',
    canViewAll: granted.has(JE_DRAFT_PERMISSIONS.VIEW_ALL),
    canVoidOwn: granted.has(JE_DRAFT_PERMISSIONS.VOID),
    canVoidAny: granted.has(JE_DRAFT_PERMISSIONS.VOID_ANY),
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
    error instanceof DraftVoidReasonRequiredError
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
});

// BR214-1 — every field optional so ANY state saves.
const DraftSchema = z.object({
  entityId: z.string().nullable().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  sourceCode: z.string().nullable().optional(),
  memo: z.string().max(500).nullable().optional(),
  lines: z.array(LineSchema).optional(),
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
      const draft = await svc.create({ tenantId, preparer: (request.user?.sub as string) ?? 'system', ...body });
      return reply.status(201).send({ draftId: draft.id, status: draft.status, version: draft.version });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET list — scoped to preparer unless view_all (BR214-2).
  app.get('/manual-journals/drafts', { preHandler: requireDraftReader() }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const drafts = await svc.list(actorOf(request, tenantId));
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
      const draft = await svc.get(id, actorOf(request, tenantId));
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
      const draft = await svc.update(id, body, actorOf(request, tenantId));
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
      const att = await svc.addAttachment(id, body, actorOf(request, tenantId));
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
      const actor = actorOf(request, tenantId);

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

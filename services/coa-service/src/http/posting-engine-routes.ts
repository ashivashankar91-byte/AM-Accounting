import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  PostingEngineService,
  PostingEngineInputError,
  RulePackNotFoundError,
  RulePackVersionNotFoundError,
  ActivationNotEligibleError,
  ActivationSoDViolationError,
  EventIdentityConflictError,
  SelfActivationForbiddenError,
  AmbiguousRulePackMatchError,
  ReplayNotEligibleError,
  PostingExecutionNotFoundError,
} from '../application/posting-engine-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

/**
 * CE-07 legal-entity isolation defect — the browser must not infer or
 * calculate legal-entity ownership: every rule-pack/execution list, filter,
 * and inquiry route requires an explicit `entityId` query param, exactly
 * like `x-tenant-id` is already required. Missing it is a 400, never a
 * silent "show everything" fallback.
 */
function getEntityIdParam(request: any): string {
  const id = getEntityIdParamOrNull(request);
  if (!id) {
    const e: any = new Error('entityId query parameter is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

/**
 * Non-throwing variant for authz `scope` callbacks specifically: scope
 * resolution runs BEFORE the permission check inside the guard (see
 * authz-guard.ts), so throwing here would turn "no permission" into a 400
 * instead of the correct 403 whenever entityId is also missing — masking
 * the deny-by-default guarantee. The route handler's own getEntityIdParam
 * call (after the guard has already run) is the one authoritative place
 * that turns a missing entityId into 400.
 */
function getEntityIdParamOrNull(request: any): string | undefined {
  return ((request.query as Record<string, string | undefined>)?.['entityId'])?.trim() || undefined;
}

/** Best-effort parse of `entityId` out of a create-draft request body's raw sourceText JSON, used ONLY to resolve the authz scope before the handler (and its own, authoritative validation) runs. A parse failure here resolves to no entity scope — the handler's own createRulePackVersion call still rejects a missing/invalid entityId with PostingEngineInputError; this never widens what the handler accepts. */
function parseEntityIdFromSourceText(sourceText: unknown): string | undefined {
  if (typeof sourceText !== 'string') return undefined;
  try {
    const doc = JSON.parse(sourceText);
    const entityId = doc?.entityId;
    return typeof entityId === 'string' && entityId ? entityId : undefined;
  } catch {
    return undefined;
  }
}

// ── Authorization (deny-by-default, centralized through the real S207 authz) ─
export const POSTING_ENGINE_PERMISSIONS = {
  VIEW_RULE_PACK: 'posting_engine.rule_pack.view',
  EDIT_RULE_PACK: 'posting_engine.rule_pack.edit',
  VALIDATE_RULE_PACK: 'posting_engine.rule_pack.validate',
  ACTIVATE_RULE_PACK: 'posting_engine.rule_pack.activate',
  SIMULATE_RULE_PACK: 'posting_engine.rule_pack.simulate',
  VIEW_EXECUTION: 'posting_engine.execution.view',
  VIEW_EXCEPTION: 'posting_engine.exception.view',
  /** D-S023-33 — new capability, added under the existing posting_engine.<noun>.<verb> namespace (S023_PERMISSION_MATRIX.md). */
  SIMULATE_RULE_PACK: 'posting_engine.rule_pack.simulate',
  /** D-S023-25/28 — replay reuses S021's own existing permission, not a new S023 string (S023_PERMISSION_MATRIX.md). */
  REPLAY_EXECUTE: 'posting-recovery.replay.execute',
} as const;

/**
 * CE-07 legal-entity isolation defect — `scope` lets a route resolve the
 * entityId to check the caller's permission against, either directly off
 * the request (query param, request body) or, for routes acting on an
 * already-persisted resource, by loading that resource and returning ITS
 * entityId (createAuthzGuard's scope extractor supports async since this
 * fix — see authz-guard.ts). Omitting scope means tenant-only scoping,
 * unchanged from before this fix.
 */
export function requirePostingEnginePermission(permission: string, scope?: (request: any) => { entityId?: string | null } | Promise<{ entityId?: string | null }>) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId, scope })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof RulePackNotFoundError || error instanceof RulePackVersionNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof ActivationNotEligibleError || error instanceof ReplayNotEligibleError || error instanceof ActivationSoDViolationError) {
    return reply.status(422).send({ error: (error as any).code, message: error.message });
  }
  if (error instanceof SelfActivationForbiddenError) {
    return reply.status(403).send({ error: error.code, message: error.message });
  }
  if (error instanceof PostingExecutionNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof EventIdentityConflictError) {
    return reply.status(409).send({ error: error.code, message: error.message, executionId: error.executionId, eventId: error.eventId });
  }
  if (error instanceof AmbiguousRulePackMatchError) {
    return reply.status(409).send({ error: error.code, message: error.message, candidateVersionIds: error.candidateVersionIds });
  }
  if (error instanceof PostingEngineInputError) {
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

const CreateRulePackSchema = z.object({
  packKey: z.string().min(1).optional(),
  sourceText: z.string().min(1),
});
const ValidateDraftSchema = z.object({ sourceText: z.string().min(1) });

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────
export async function postingEngineRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<PostingEngineService>('PostingEngineService');

  // ── Rule pack lifecycle ────────────────────────────────────────────────────

  app.post('/posting-engine/rule-packs/validate', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VALIDATE_RULE_PACK) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = ValidateDraftSchema.parse(request.body ?? {});
      const result = await svc.validateDraftSource(tenantId, body.sourceText);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/posting-engine/rule-packs', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.EDIT_RULE_PACK, (request) => ({
      entityId: parseEntityIdFromSourceText((request.body as any)?.sourceText),
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateRulePackSchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const version = await svc.createRulePackVersion({ tenantId, packKey: body.packKey ?? '', sourceText: body.sourceText, actor });
      return reply.status(201).send(version);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/posting-engine/rule-packs', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_RULE_PACK, (request) => ({ entityId: getEntityIdParamOrNull(request) })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const entityId = getEntityIdParam(request);
      const items = await svc.listRulePacks(tenantId, entityId);
      return reply.status(200).send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/posting-engine/rule-packs/:packKey', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_RULE_PACK, (request) => ({ entityId: getEntityIdParamOrNull(request) })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const entityId = getEntityIdParam(request);
      const packKey = (request.params as any).packKey as string;
      const result = await svc.getRulePack(tenantId, packKey, entityId);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/posting-engine/rule-pack-versions/:id/validate', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VALIDATE_RULE_PACK, async (request) => ({
      entityId: await svc.resolveVersionEntityId(getTenantId(request), (request.params as any).id as string),
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await svc.validateVersion(tenantId, id, actor);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/posting-engine/rule-pack-versions/:id/activate', {
    // CE-07 legal-entity isolation defect — the activation ceremony's own
    // permission check is scoped to the SPECIFIC version's entityId (loaded
    // fresh, never client-supplied), so an activator authorized only for
    // entity A can never activate — and therefore can never supersede —
    // entity B's version, even if they somehow know its id.
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.ACTIVATE_RULE_PACK, async (request) => ({
      entityId: await svc.resolveVersionEntityId(getTenantId(request), (request.params as any).id as string),
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await svc.activateVersion(tenantId, id, actor);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── Event ingestion (internal application boundary) ────────────────────────
  // Not gated by a posting_engine.* business permission — in production this
  // is a service-to-service call (the source system, not a human), and the
  // spec's permission list (view/edit/validate/activate rule packs, view
  // executions/exceptions) deliberately has no "submit event" entry. Gated by
  // the same authenticated-tenant-context requirement as every other route
  // here (authMiddleware + x-tenant-id) so it cannot be called anonymously or
  // cross-tenant; the certification fixtures' browser journey calls this as
  // the "supported test journey" the story asks for.
  app.post('/posting-engine/events', async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await svc.submitEvent(tenantId, request.body ?? {}, actor);
      return reply.status(result.idempotent || result.status !== 'POSTED' ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── Simulation (D-S023-33): validation + evaluation only, never posts ──────
  app.post('/posting-engine/simulate', {
    // Simulation's envelope already carries legalEntityId in the raw
    // request body (same as submitEvent) — no DB lookup needed to scope it.
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.SIMULATE_RULE_PACK, (request) => ({
      entityId: (request.body as any)?.legalEntityId,
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await svc.simulateEvent(tenantId, request.body ?? {}, actor);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // S024 (CE-12) — dry-run blueprint preview, no persistence/posting. Gated
  // by a real business permission (unlike /events) since this is a human-
  // facing preview action (S085 biller workbench), not a source-system feed.
  app.post('/posting-engine/events/simulate', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.SIMULATE_RULE_PACK, (request) => ({
      entityId: (request.body as any)?.legalEntityId,
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const result = await svc.simulate(tenantId, request.body ?? {});
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── Execution / exception inquiry ───────────────────────────────────────────

  // ── Replay (D-S023-25, joint with D-S023-22): authorized corrected replay ──
  const ReplaySchema = z.object({ reason: z.string().min(1) });
  app.post('/posting-engine/executions/:id/replay', {
    // CE-07 legal-entity isolation defect — scoped to the execution's OWN
    // entityId (loaded fresh), never a client-supplied value, so a replay
    // can never be authorized against another entity's execution.
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.REPLAY_EXECUTE, async (request) => ({
      entityId: await svc.resolveExecutionEntityId(getTenantId(request), (request.params as any).id as string),
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const body = ReplaySchema.parse(request.body ?? {});
      const actor = (request.user?.sub as string | undefined) ?? 'system';
      const result = await svc.replayEvent(tenantId, id, actor, body.reason);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── Execution / exception inquiry ───────────────────────────────────────────

  app.get('/posting-engine/executions', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION, (request) => ({ entityId: getEntityIdParamOrNull(request) })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const entityId = getEntityIdParam(request);
      const q = request.query as Record<string, string | undefined>;
      const items = await svc.searchExecutions(tenantId, entityId, { correlationId: q['correlationId'], sourceEntityId: q['sourceEntityId'], status: q['status'] });
      return reply.status(200).send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/posting-engine/executions/by-event/:eventId', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION, async (request) => ({
      entityId: await svc.resolveExecutionEntityIdByEventId(getTenantId(request), (request.params as any).eventId as string),
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const eventId = (request.params as any).eventId as string;
      const execution = await svc.getExecutionByEventId(tenantId, eventId);
      if (!execution) return reply.status(404).send({ error: 'EXECUTION_NOT_FOUND', message: `No execution found for event ${eventId}` });
      return reply.status(200).send(execution);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/posting-engine/executions/:id', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION, async (request) => ({
      entityId: await svc.resolveExecutionEntityId(getTenantId(request), (request.params as any).id as string),
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const execution = await svc.getExecutionById(tenantId, id);
      if (!execution) return reply.status(404).send({ error: 'EXECUTION_NOT_FOUND', message: `No execution found with id ${id}` });
      return reply.status(200).send(execution);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // ── Replay evidence (execution inquiry — S023 UI lineage view) ─────────────
  app.get('/posting-engine/executions/:id/replays', {
    preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION, async (request) => ({
      entityId: await svc.resolveExecutionEntityId(getTenantId(request), (request.params as any).id as string),
    })),
  }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const id = (request.params as any).id as string;
      const items = await svc.listReplaysForExecution(tenantId, id);
      return reply.status(200).send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/posting-engine/exceptions', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_EXCEPTION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string | undefined>;
      const items = await svc.listExceptions(tenantId, q['reasonCode']);
      return reply.status(200).send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

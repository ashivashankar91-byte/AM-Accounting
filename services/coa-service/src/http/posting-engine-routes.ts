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
  EventIdentityConflictError,
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

// ── Authorization (deny-by-default, centralized through the real S207 authz) ─
export const POSTING_ENGINE_PERMISSIONS = {
  VIEW_RULE_PACK: 'posting_engine.rule_pack.view',
  EDIT_RULE_PACK: 'posting_engine.rule_pack.edit',
  VALIDATE_RULE_PACK: 'posting_engine.rule_pack.validate',
  ACTIVATE_RULE_PACK: 'posting_engine.rule_pack.activate',
  VIEW_EXECUTION: 'posting_engine.execution.view',
  VIEW_EXCEPTION: 'posting_engine.exception.view',
} as const;

export function requirePostingEnginePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof RulePackNotFoundError || error instanceof RulePackVersionNotFoundError) {
    return reply.status(404).send({ error: error.code, message: error.message });
  }
  if (error instanceof ActivationNotEligibleError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof EventIdentityConflictError) {
    return reply.status(409).send({ error: error.code, message: error.message, executionId: error.executionId, eventId: error.eventId });
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

  app.post('/posting-engine/rule-packs', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.EDIT_RULE_PACK) }, async (request, reply) => {
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

  app.get('/posting-engine/rule-packs', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_RULE_PACK) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const items = await svc.listRulePacks(tenantId);
      return reply.status(200).send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/posting-engine/rule-packs/:packKey', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_RULE_PACK) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const packKey = (request.params as any).packKey as string;
      const result = await svc.getRulePack(tenantId, packKey);
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/posting-engine/rule-pack-versions/:id/validate', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VALIDATE_RULE_PACK) }, async (request, reply) => {
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

  app.post('/posting-engine/rule-pack-versions/:id/activate', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.ACTIVATE_RULE_PACK) }, async (request, reply) => {
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

  // ── Execution / exception inquiry ───────────────────────────────────────────

  app.get('/posting-engine/executions', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string | undefined>;
      const items = await svc.searchExecutions(tenantId, { correlationId: q['correlationId'], sourceEntityId: q['sourceEntityId'], status: q['status'] });
      return reply.status(200).send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/posting-engine/executions/by-event/:eventId', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION) }, async (request, reply) => {
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

  app.get('/posting-engine/executions/:id', { preHandler: requirePostingEnginePermission(POSTING_ENGINE_PERMISSIONS.VIEW_EXECUTION) }, async (request, reply) => {
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

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { AutoMatchService } from '../application/auto-match-service';
import {
  MatchRuleInputError, MatchRuleNotFoundError, SuggestionNotFoundError, SuggestionNotPendingError,
} from '../domain/auto-match-rules';
import { ReconSessionNotFoundError, ReconSessionNotOpenError } from '../domain/recon-session';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

function getActor(request: any): string {
  return request.user?.sub ?? 'unknown';
}

export const AUTO_MATCH_PERMISSIONS = {
  RULE_CONFIG: 'recon.matchrule.config',
  RUN: 'recon.automatch.run',
  SUGGESTION_VIEW: 'recon.suggestion.view',
  SUGGESTION_RESOLVE: 'recon.suggestion.resolve',
} as const;

function requirePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof MatchRuleNotFoundError || error instanceof SuggestionNotFoundError || error instanceof ReconSessionNotFoundError) {
    return reply.status(404).send({ error: (error as any).code, message: error.message });
  }
  if (error instanceof SuggestionNotPendingError || error instanceof ReconSessionNotOpenError) {
    return reply.status(409).send({ error: (error as any).code, message: error.message });
  }
  if (error instanceof MatchRuleInputError) {
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

const CreateRuleSchema = z.object({
  entityId: z.string().nullable().optional(),
  bankAccountCode: z.string().nullable().optional(),
  ruleType: z.enum(['AMOUNT_DATE_WINDOW', 'REFERENCE_CONTAINS', 'CHECK_NUMBER', 'BATCH_TOTAL']),
  tier: z.enum(['EXACT', 'SUGGESTED']),
  config: z.record(z.any()),
  priority: z.number().optional(),
});

export async function autoMatchRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<AutoMatchService>('AutoMatchService');

  app.post('/match-rules', { preHandler: requirePermission(AUTO_MATCH_PERMISSIONS.RULE_CONFIG) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateRuleSchema.parse(request.body);
      return reply.status(201).send(await svc.createRule({ ...body, tenantId, actor: getActor(request) }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/match-rules', { preHandler: requirePermission(AUTO_MATCH_PERMISSIONS.RULE_CONFIG) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      return reply.send(await svc.listRules(tenantId));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/auto-match', { preHandler: requirePermission(AUTO_MATCH_PERMISSIONS.RUN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.runAutoMatch(tenantId, id, getActor(request)));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/sessions/:id/suggestions', { preHandler: requirePermission(AUTO_MATCH_PERMISSIONS.SUGGESTION_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.listSuggestions(tenantId, id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/suggestions/:suggestionId/confirm', { preHandler: requirePermission(AUTO_MATCH_PERMISSIONS.SUGGESTION_RESOLVE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id, suggestionId } = request.params as { id: string; suggestionId: string };
      return reply.send(await svc.confirmSuggestion(tenantId, id, suggestionId, getActor(request)));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/suggestions/:suggestionId/reject', { preHandler: requirePermission(AUTO_MATCH_PERMISSIONS.SUGGESTION_RESOLVE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id, suggestionId } = request.params as { id: string; suggestionId: string };
      return reply.send(await svc.rejectSuggestion(tenantId, id, suggestionId, getActor(request)));
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

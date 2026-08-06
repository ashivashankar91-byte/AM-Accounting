import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import { ReconSessionService } from '../application/recon-session-service';
import {
  ReconInputError, ReconSessionNotFoundError, ReconStatementLineNotFoundError, ReconBookItemNotFoundError,
  ReconSessionNotOpenError, ReconAlreadyClearedError, ReconNotClearedError, ReconOutOfBalanceError,
} from '../domain/recon-session';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export const RECON_SESSION_PERMISSIONS = {
  CREATE: 'recon.session.create',
  VIEW: 'recon.session.view',
  LINE_MANAGE: 'recon.session.line.manage',
  BOOKITEM_MANAGE: 'recon.session.bookitem.manage',
  MATCH: 'recon.session.match',
  COMPLETE: 'recon.session.complete',
} as const;

function requirePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof ReconSessionNotFoundError || error instanceof ReconStatementLineNotFoundError || error instanceof ReconBookItemNotFoundError) {
    return reply.status(404).send({ error: (error as any).code, message: error.message });
  }
  if (
    error instanceof ReconSessionNotOpenError ||
    error instanceof ReconAlreadyClearedError ||
    error instanceof ReconNotClearedError ||
    error instanceof ReconOutOfBalanceError
  ) {
    return reply.status(409).send({ error: (error as any).code, message: error.message });
  }
  if (error instanceof ReconInputError) {
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

const CreateSessionSchema = z.object({
  entityId: z.string().min(1),
  bankAccountCode: z.string().min(1),
  periodStart: z.string(),
  periodEnd: z.string(),
  statementBeginningBalance: z.number(),
  statementEndingBalance: z.number(),
  idempotencyKey: z.string().min(1),
});

const AddStatementLineSchema = z.object({
  lineDate: z.string(),
  description: z.string().min(1),
  amount: z.number(),
  source: z.enum(['MANUAL', 'IMPORTED']),
  externalRef: z.string().nullable().optional(),
});

const ImportStatementLinesSchema = z.object({
  lines: z.array(z.object({
    lineDate: z.string(),
    description: z.string().min(1),
    amount: z.number(),
    externalRef: z.string().nullable().optional(),
  })).min(1),
});

const AddManualBookItemSchema = z.object({
  itemType: z.enum(['PAYMENT', 'DEPOSIT', 'FEE', 'NSF', 'SWEEP']),
  itemDate: z.string(),
  description: z.string().min(1),
  amount: z.number(),
});

const MatchSchema = z.object({
  statementLineId: z.string().uuid(),
  bookItemId: z.string().uuid(),
});

const UnmatchSchema = z.object({
  statementLineId: z.string().uuid(),
  reason: z.string().min(1),
});

function getActor(request: any): string {
  return request.user?.sub ?? 'unknown';
}

export async function reconSessionRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<ReconSessionService>('ReconSessionService');

  app.post('/sessions', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.CREATE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateSessionSchema.parse(request.body);
      const session = await svc.createSession({ ...body, tenantId, actor: getActor(request) });
      return reply.status(session.idempotent ? 200 : 201).send(session);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/sessions', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as any;
      return reply.send(await svc.listSessions(tenantId, { status: q.status, bankAccountCode: q.bankAccountCode, limit: q.limit ? Number(q.limit) : undefined, offset: q.offset ? Number(q.offset) : undefined }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/sessions/:id', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.getSession(tenantId, id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/sessions/:id/statement-lines', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.listStatementLines(tenantId, id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/statement-lines', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.LINE_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = AddStatementLineSchema.parse(request.body);
      return reply.status(201).send(await svc.addStatementLine({ ...body, tenantId, sessionId: id, actor: getActor(request) }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/statement-lines/import', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.LINE_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = ImportStatementLinesSchema.parse(request.body);
      return reply.status(201).send(await svc.importStatementLines({ ...body, tenantId, sessionId: id, actor: getActor(request) }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/sessions/:id/book-items', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.listBookItems(tenantId, id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/book-items', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.BOOKITEM_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = AddManualBookItemSchema.parse(request.body);
      return reply.status(201).send(await svc.addManualBookItem({ ...body, tenantId, sessionId: id, actor: getActor(request) }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/book-items/sync', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.BOOKITEM_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.syncBookItems(tenantId, id, getActor(request)));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/match', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.MATCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = MatchSchema.parse(request.body);
      return reply.send(await svc.matchLine({ ...body, tenantId, sessionId: id, actor: getActor(request) }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/unmatch', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.MATCH) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const body = UnmatchSchema.parse(request.body);
      return reply.send(await svc.unmatchLine({ ...body, tenantId, sessionId: id, actor: getActor(request) }));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.post('/sessions/:id/complete', { preHandler: requirePermission(RECON_SESSION_PERMISSIONS.COMPLETE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const session = await svc.completeSession(tenantId, id, getActor(request));
      return reply.send(session);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

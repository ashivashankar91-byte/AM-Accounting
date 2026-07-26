import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  AccountService,
  AccountValidationError,
  DuplicateAccountError,
  TypeImmutableError,
  NonZeroBalanceError,
  AccountNotFoundError,
  CycleError,
  MaxDepthError,
  ParentNotSummaryError,
  ParentNotFoundError,
} from '../application/account-service';

function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

// ── Authorization (deny-by-default, centralized through S207) ─────────────────
// Permission strings per packet §2: coa.account.view, coa.account.manage.
// R0 Stabilization Phase 3: the local ROLE_PERMISSIONS stub that used to live
// here was replaced by a call to the real S207 AuthzService (via
// HttpAuthzClient, registered as 'AuthzClient' in src/index.ts). Grants now
// live centrally in auth-service's permission/role_permission catalog (see
// services/auth-service/prisma/migrations/20260726000001_extend_authz_catalog_r0_stabilization).

export const ACCOUNT_PERMISSIONS = {
  VIEW: 'coa.account.view',
  MANAGE: 'coa.account.manage',
} as const;

export function requireAccountPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (error instanceof DuplicateAccountError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof TypeImmutableError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof NonZeroBalanceError) {
    return reply.status(422).send({ error: error.code, message: error.message, balance: error.balance });
  }
  if (error instanceof AccountValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (
    error instanceof CycleError ||
    error instanceof MaxDepthError ||
    error instanceof ParentNotSummaryError ||
    error instanceof ParentNotFoundError
  ) {
    return reply.status(422).send({ error: (error as any).code, message: error.message });
  }
  if (error instanceof AccountNotFoundError) {
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

const CreateSchema = z.object({
  entityId: z.string().min(1),
  accountNumber: z.string(),
  name: z.string(),
  type: z.string(),
  normalBalance: z.string().optional(),
  postable: z.boolean().optional(),
  contraReason: z.string().optional(),
  parentId: z.string().optional(),
  actor: z.string().min(1).optional(),
});

const UpdateSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  normalBalance: z.string().optional(),
  postable: z.boolean().optional(),
  contraReason: z.string().optional(),
  actor: z.string().min(1).optional(),
});

const ReparentSchema = z.object({
  parentId: z.string().nullable(),
  effectiveFrom: z.string().optional(),
  actor: z.string().min(1).optional(),
});

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────────

export async function accountRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<AccountService>('AccountService');
  const actorOf = (request: any, body: any) =>
    body?.actor ?? (request.user?.sub as string | undefined) ?? 'system';

  // POST /coa/accounts — create.
  app.post('/accounts', { preHandler: requireAccountPermission(ACCOUNT_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateSchema.parse(request.body ?? {});
      const account = await svc.create({ tenantId, ...body, actor: actorOf(request, body) });
      return reply.status(201).send(account);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /coa/accounts?entity=&status= — COA browser.
  app.get('/accounts', { preHandler: requireAccountPermission(ACCOUNT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { entity, status } = request.query as { entity?: string; status?: string };
      if (!entity) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'query param "entity" is required' });
      }
      return reply.send({ accounts: await svc.list(tenantId, entity, status) });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /coa/accounts/:id — single account.
  app.get('/accounts/:id', { preHandler: requireAccountPermission(ACCOUNT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      return reply.send(await svc.get(tenantId, id));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PATCH /coa/accounts/:id — update (name/type/normalBalance/postable) OR
  // effective-dated re-parent when the body carries `parentId` (S211 BR211-1/2/3).
  app.patch('/accounts/:id', { preHandler: requireAccountPermission(ACCOUNT_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { id } = request.params as { id: string };
      const raw = (request.body ?? {}) as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(raw, 'parentId')) {
        const body = ReparentSchema.parse(raw);
        const account = await svc.reparent({
          tenantId,
          id,
          parentId: body.parentId,
          effectiveFrom: body.effectiveFrom,
          actor: actorOf(request, body),
        });
        return reply.send(account);
      }
      const body = UpdateSchema.parse(raw);
      const account = await svc.update({ tenantId, id, ...body, actor: actorOf(request, body) });
      return reply.send(account);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /coa/tree?entity= — nested hierarchy for an entity.
  app.get('/tree', { preHandler: requireAccountPermission(ACCOUNT_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { entity } = request.query as { entity?: string };
      if (!entity) {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'query param "entity" is required' });
      }
      return reply.send({ tree: await svc.tree(tenantId, entity) });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /coa/accounts/:id/deactivate — deactivate (:deactivate).
  app.post(
    '/accounts/:id/deactivate',
    { preHandler: requireAccountPermission(ACCOUNT_PERMISSIONS.MANAGE) },
    async (request, reply) => {
      try {
        const tenantId = getTenantId(request);
        const { id } = request.params as { id: string };
        const body = (request.body ?? {}) as { actor?: string };
        const account = await svc.deactivate(tenantId, id, actorOf(request, body));
        return reply.send(account);
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}

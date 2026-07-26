import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { AuthzService } from '../application/authz-service';
import {
  UserService,
  USER_PERMISSIONS,
  UserNotFoundError,
  UserValidationError,
  DuplicateEmailError,
  LastAdminError,
  InvalidResetTokenError,
} from '../application/user-service';

// ── S205: /iam/users routes — user account lifecycle ────────────────────────────
// Deny-by-default via the real S207 AuthzPort (§11). The caller identifies with
// x-user-id + x-tenant-id; mutating ops require iam.user.manage, reads iam.user.view.
// Users hold no permissions directly (BR205-4) — access flows from S206 roles.

function svc(): UserService { return container.resolve<UserService>('UserService'); }
function authz(): AuthzService { return container.resolve<AuthzService>('AuthzService'); }

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
  return (request.headers['x-user-id'] as string | undefined)?.trim() || 'user';
}

/** Deny-by-default guard backed by the real AuthzPort (S207). Tenant-level scope. */
function requirePermission(permission: string) {
  return async function guard(request: any, reply: any) {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    const userId = (request.headers['x-user-id'] as string | undefined)?.trim();
    if (!tenantId || !userId) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'x-user-id and x-tenant-id are required (deny-by-default)',
      });
    }
    const result = await authz().check({
      userId,
      permissionKey: permission,
      scope: { tenantId, entityId: null },
      route: request.url,
    });
    if (!result.allow) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: `Missing permission: ${permission}` });
    }
  };
}

function handleError(error: unknown, reply: any) {
  if (error instanceof UserNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof DuplicateEmailError) {
    return reply.status(409).send({ error: 'DUPLICATE_EMAIL', message: error.message });
  }
  if (error instanceof LastAdminError) {
    return reply.status(422).send({ error: 'LAST_ADMIN', message: error.message });
  }
  if (error instanceof UserValidationError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof InvalidResetTokenError) {
    return reply.status(422).send({ error: 'INVALID_RESET_TOKEN', message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  throw error;
}

// ── Zod schemas ─────────────────────────────────────────────────────────────

const CreateUserSchema = z.object({
  email:       z.string().min(1).max(254),
  displayName: z.string().min(1).max(80),
  entityScope: z.array(z.string().min(1)).optional(),
  storeScope:  z.array(z.string().min(1)).optional(),
});

const SetPasswordSchema = z.object({
  resetToken:  z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export async function userRoutes(app: FastifyInstance) {
  // ── Reads ─────────────────────────────────────────────────────────────────

  app.get('/users', { preHandler: requirePermission(USER_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    return reply.status(200).send({ users: await svc().listUsers(tenantId) });
  });

  app.get('/users/:id', { preHandler: requirePermission(USER_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      return reply.status(200).send(await svc().getUser(tenantId, (request.params as any).id));
    } catch (err) { return handleError(err, reply); }
  });

  // ── Create (201 INVITED | 409 duplicate) ─────────────────────────────────────

  app.post('/users', { preHandler: requirePermission(USER_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = CreateUserSchema.parse(request.body);
      const user = await svc().createUser({ tenantId, actor: getActor(request), ...body });
      return reply.status(201).send(user);
    } catch (err) { return handleError(err, reply); }
  });

  // ── Deactivate (200 + session revocation | 422 last-admin-self) ───────────────

  app.post('/users/:id/deactivate', { preHandler: requirePermission(USER_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const result = await svc().deactivateUser(tenantId, (request.params as any).id, getActor(request));
      return reply.status(200).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  // ── Unlock (200, failedLogins:0) ─────────────────────────────────────────────

  app.post('/users/:id/unlock', { preHandler: requirePermission(USER_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const user = await svc().unlockUser(tenantId, (request.params as any).id, getActor(request));
      return reply.status(200).send(user);
    } catch (err) { return handleError(err, reply); }
  });

  // ── Reset (202, reset-token issued) ──────────────────────────────────────────

  app.post('/users/:id/reset', { preHandler: requirePermission(USER_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const result = await svc().resetUser(tenantId, (request.params as any).id, getActor(request));
      return reply.status(202).send(result);
    } catch (err) { return handleError(err, reply); }
  });

  // ── Set password (public — guarded by the one-time reset token itself, ──────
  //    not by a permission check: the caller has no session yet). FINAL-R0 S205.
  app.post('/users/:id/set-password', async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = SetPasswordSchema.parse(request.body);
      const user = await svc().setPassword(tenantId, (request.params as any).id, body.resetToken, body.newPassword);
      return reply.status(200).send({ user });
    } catch (err) { return handleError(err, reply); }
  });
}

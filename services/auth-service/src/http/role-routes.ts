import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { AuthzService } from '../application/authz-service';
import {
  RoleService,
  ROLE_PERMISSIONS,
  RoleNotFoundError,
  RoleValidationError,
  RoleInUseError,
  AssignmentScopeError,
} from '../application/role-service';

// ── S206: /iam routes — roles & role-assignments ────────────────────────────────
// Access is enforced deny-by-default via the real S207 AuthzPort (§11). The caller
// identifies with x-user-id + x-tenant-id; role ops require iam.role.manage,
// assignment ops require iam.role.assign, reads require iam.role.view.

function svc(): RoleService { return container.resolve<RoleService>('RoleService'); }
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

/** Deny-by-default guard backed by the real AuthzPort (S207). */
function requirePermission(permission: string, scopeFrom?: (request: any) => { entityId?: string }) {
  return async function guard(request: any, reply: any) {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    const userId = (request.headers['x-user-id'] as string | undefined)?.trim();
    if (!tenantId || !userId) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'x-user-id and x-tenant-id are required (deny-by-default)',
      });
    }
    const extra = scopeFrom?.(request) ?? {};
    const result = await authz().check({
      userId,
      permissionKey: permission,
      scope: { tenantId, entityId: extra.entityId ?? null },
      route: request.url,
    });
    if (!result.allow) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: `Missing permission: ${permission}` });
    }
  };
}

function handleError(error: unknown, reply: any) {
  if (error instanceof RoleNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof RoleInUseError) {
    return reply.status(409).send({ error: 'ROLE_IN_USE', message: error.message });
  }
  if (error instanceof RoleValidationError) {
    const status = error.code === 'ROLE_EXISTS' ? 409 : 422;
    return reply.status(status).send({ error: error.code, message: error.message });
  }
  if (error instanceof AssignmentScopeError) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: error.issues });
  }
  throw error;
}

// ── Zod schemas ─────────────────────────────────────────────────────────────

const CreateRoleSchema = z.object({
  name:        z.string().min(1).max(60),
  permissions: z.array(z.string().min(1)).min(1),
});

const UpdateRoleSchema = z.object({
  name:        z.string().min(1).max(60).optional(),
  permissions: z.array(z.string().min(1)).min(1).optional(),
});

const GrantAssignmentSchema = z.object({
  userId:    z.string().min(1),
  roleId:    z.string().min(1),
  entityId:  z.string().min(1),
  storeIds:  z.array(z.string().min(1)).optional(),
  allStores: z.boolean().optional(),
});

export async function roleRoutes(app: FastifyInstance) {
  // ── Roles ─────────────────────────────────────────────────────────────────

  app.get('/roles', { preHandler: requirePermission(ROLE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    return reply.status(200).send({ roles: await svc().listRoles(tenantId) });
  });

  app.get('/roles/:id', { preHandler: requirePermission(ROLE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      return reply.status(200).send(await svc().getRole(tenantId, (request.params as any).id));
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/roles', { preHandler: requirePermission(ROLE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = CreateRoleSchema.parse(request.body);
      const role = await svc().createRole({ tenantId, actor: getActor(request), ...body });
      return reply.status(201).send(role);
    } catch (err) { return handleError(err, reply); }
  });

  app.patch('/roles/:id', { preHandler: requirePermission(ROLE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = UpdateRoleSchema.parse(request.body);
      const role = await svc().updateRole(tenantId, (request.params as any).id, { actor: getActor(request), ...body });
      return reply.status(200).send(role);
    } catch (err) { return handleError(err, reply); }
  });

  app.delete('/roles/:id', { preHandler: requirePermission(ROLE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      await svc().retireRole(tenantId, (request.params as any).id, getActor(request));
      return reply.status(204).send();
    } catch (err) { return handleError(err, reply); }
  });

  // ── Assignments ─────────────────────────────────────────────────────────────

  app.get('/role-assignments', { preHandler: requirePermission(ROLE_PERMISSIONS.VIEW) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const userId = (request.query as any)?.userId as string | undefined;
    return reply.status(200).send({ assignments: await svc().listAssignments(tenantId, userId) });
  });

  app.post('/role-assignments', {
    preHandler: requirePermission(ROLE_PERMISSIONS.ASSIGN, (req) => ({ entityId: (req.body as any)?.entityId })),
  }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = GrantAssignmentSchema.parse(request.body);
      const assignment = await svc().grantAssignment({ tenantId, actor: getActor(request), ...body });
      return reply.status(201).send(assignment);
    } catch (err) { return handleError(err, reply); }
  });

  app.delete('/role-assignments/:id', { preHandler: requirePermission(ROLE_PERMISSIONS.ASSIGN) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      await svc().revokeAssignment(tenantId, (request.params as any).id, getActor(request));
      return reply.status(204).send();
    } catch (err) { return handleError(err, reply); }
  });
}

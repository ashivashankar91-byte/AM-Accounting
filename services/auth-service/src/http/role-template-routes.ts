import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { AuthzService } from '../application/authz-service';
import {
  RoleTemplateService,
  ROLE_TEMPLATE_PERMISSIONS,
  RoleTemplateNotFoundError,
  RoleTemplateValidationError,
  RoleTemplateInUseError,
  SelfApplyForbiddenError,
} from '../application/role-template-service';
import { RoleNotFoundError, RoleValidationError, AssignmentScopeError } from '../application/role-service';

// ── S004A: /iam/role-templates routes ───────────────────────────────────────────
// Deny-by-default via the real S207 AuthzPort (authz().check()) AND real JWT
// verification (authMiddleware) — caller identity is the verified JWT subject
// (request.user.sub), never a client-supplied header, matching the S206
// role-routes.ts hardening. Template define/edit/clone/deactivate require
// iam.roletemplate.manage; viewing and applying require iam.roletemplate.apply.

function svc(): RoleTemplateService { return container.resolve<RoleTemplateService>('RoleTemplateService'); }
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
  return (request.user?.sub as string | undefined)?.trim() || 'user';
}

function requirePermission(permission: string) {
  return async function guard(request: any, reply: any) {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    const userId = (request.user?.sub as string | undefined)?.trim();
    if (!tenantId || !userId) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'An authenticated JWT and x-tenant-id are required (deny-by-default)',
      });
    }
    const result = await authz().check({
      userId, permissionKey: permission, scope: { tenantId }, route: request.url,
    });
    if (!result.allow) {
      return reply.status(403).send({ error: 'FORBIDDEN', message: `Missing permission: ${permission}` });
    }
  };
}

function handleError(error: unknown, reply: any) {
  if (error instanceof RoleTemplateNotFoundError || error instanceof RoleNotFoundError) {
    return reply.status(404).send({ error: 'NOT_FOUND', message: error.message });
  }
  if (error instanceof RoleTemplateInUseError) {
    return reply.status(409).send({ error: 'TEMPLATE_IN_USE', message: error.message });
  }
  if (error instanceof SelfApplyForbiddenError) {
    return reply.status(403).send({ error: 'SELF_APPLY_FORBIDDEN', message: error.message });
  }
  if (error instanceof RoleTemplateValidationError) {
    const status = error.code === 'TEMPLATE_EXISTS' ? 409
      : error.code === 'TEMPLATE_IMMUTABLE' ? 403
      : 422;
    return reply.status(status).send({ error: error.code, message: error.message });
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

const CreateTemplateSchema = z.object({
  name:             z.string().min(1).max(60),
  key:              z.string().min(1).max(40).optional(),
  permissions:      z.array(z.string().min(1)).optional(),
  fieldMasks:       z.array(z.string().min(1)).optional(),
  sourceTemplateId: z.string().min(1).optional(),
});

const UpdateTemplateSchema = z.object({
  name:        z.string().min(1).max(60).optional(),
  permissions: z.array(z.string().min(1)).min(1).optional(),
  fieldMasks:  z.array(z.string().min(1)).optional(),
});

const CloneTemplateSchema = z.object({
  name: z.string().min(1).max(60),
});

const ApplyTemplateSchema = z.object({
  templateId: z.string().min(1),
  userId:     z.string().min(1),
  entityId:   z.string().min(1),
  storeIds:   z.array(z.string().min(1)).optional(),
  allStores:  z.boolean().optional(),
});

export async function roleTemplateRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  // ── Templates ─────────────────────────────────────────────────────────────────

  app.get('/role-templates', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.APPLY) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    return reply.status(200).send({ templates: await svc().listTemplates(tenantId) });
  });

  app.get('/role-templates/:id', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.APPLY) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      return reply.status(200).send(await svc().getTemplate(tenantId, (request.params as any).id));
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/role-templates', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = CreateTemplateSchema.parse(request.body);
      const template = await svc().createTemplate({
        tenantId, actor: getActor(request),
        name: body.name, key: body.key, permissions: body.permissions ?? [],
        fieldMasks: body.fieldMasks, sourceTemplateId: body.sourceTemplateId,
      });
      return reply.status(201).send(template);
    } catch (err) { return handleError(err, reply); }
  });

  app.post('/role-templates/:id/clone', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = CloneTemplateSchema.parse(request.body);
      const template = await svc().cloneTemplate(tenantId, (request.params as any).id, body.name, getActor(request));
      return reply.status(201).send(template);
    } catch (err) { return handleError(err, reply); }
  });

  app.patch('/role-templates/:id', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = UpdateTemplateSchema.parse(request.body);
      const template = await svc().updateTemplate(tenantId, (request.params as any).id, { actor: getActor(request), ...body });
      return reply.status(200).send(template);
    } catch (err) { return handleError(err, reply); }
  });

  app.delete('/role-templates/:id', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      await svc().deactivateTemplate(tenantId, (request.params as any).id, getActor(request));
      return reply.status(204).send();
    } catch (err) { return handleError(err, reply); }
  });

  // ── Apply / assignments ──────────────────────────────────────────────────────

  app.post('/role-templates:apply', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.APPLY) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      const body = ApplyTemplateSchema.parse(request.body);
      const assignment = await svc().applyTemplate({ tenantId, actor: getActor(request), ...body });
      return reply.status(201).send(assignment);
    } catch (err) { return handleError(err, reply); }
  });

  app.get('/role-template-assignments', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.APPLY) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    const userId = (request.query as any)?.userId as string | undefined;
    return reply.status(200).send({ assignments: await svc().listAssignments(tenantId, userId) });
  });

  app.delete('/role-template-assignments/:id', { preHandler: requirePermission(ROLE_TEMPLATE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    const tenantId = getTenantId(request);
    try {
      await svc().revokeAssignment(tenantId, (request.params as any).id, getActor(request));
      return reply.status(204).send();
    } catch (err) { return handleError(err, reply); }
  });
}

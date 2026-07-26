import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';
import {
  SourceService,
  SourceValidationError,
  DuplicateSourceError,
  SystemSourceCreationError,
  ReservedImmutableError,
  SystemSourceNotManualError,
  SourceNotFoundError,
} from '../application/source-service';

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
export const SOURCE_PERMISSIONS = { MANAGE: 'coa.source.manage', VIEW: 'coa.source.view' } as const;

// R0 Stabilization Phase 3: centralized through the real S207 AuthzService
// (see account-routes.ts header comment for full rationale).
export function requireSourcePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

function handleError(error: unknown, reply: any) {
  if (
    error instanceof SourceValidationError ||
    error instanceof SystemSourceCreationError ||
    error instanceof ReservedImmutableError ||
    error instanceof SystemSourceNotManualError
  ) {
    return reply.status(422).send({ error: error.code, message: error.message });
  }
  if (error instanceof DuplicateSourceError) {
    return reply.status(409).send({ error: error.code, message: error.message });
  }
  if (error instanceof SourceNotFoundError) {
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

const FlagsSchema = z
  .object({ autoPost: z.boolean(), yearEndOnly: z.boolean(), thirteenthOnly: z.boolean() })
  .partial();

const CreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  sourceClass: z.enum(['MANUAL', 'SYSTEM']).optional(),
  numericAlias: z.number().int().nullable().optional(),
  flags: FlagsSchema.optional(),
  actor: z.string().min(1).optional(),
});

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  flags: FlagsSchema.optional(),
  actor: z.string().min(1).optional(),
});

const AssertManualSchema = z.object({ code: z.string().min(1) });

// ── Routes (registered under /api/v1/coa) ────────────────────────────────────────

export async function sourceRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve<SourceService>('SourceService');
  const actorOf = (request: any, body: any) =>
    body?.actor ?? (request.user?.sub as string | undefined) ?? 'system';

  // POST /journal-sources — create a tenant MANUAL source.
  app.post('/journal-sources', { preHandler: requireSourcePermission(SOURCE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = CreateSchema.parse(request.body ?? {});
      const row = await svc.create({
        tenantId,
        code: body.code,
        name: body.name,
        sourceClass: body.sourceClass,
        numericAlias: body.numericAlias ?? null,
        flags: body.flags,
        actor: actorOf(request, body),
      });
      return reply.status(201).send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /journal-sources/bootstrap-reserved — idempotent reserved seeding.
  app.post('/journal-sources/bootstrap-reserved', { preHandler: requireSourcePermission(SOURCE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const result = await svc.bootstrapReserved(tenantId, actorOf(request, request.body));
      return reply.status(200).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /journal-sources/assert-manual — BR212-1 guard (reused by S214 JE path).
  app.post('/journal-sources/assert-manual', { preHandler: requireSourcePermission(SOURCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = AssertManualSchema.parse(request.body ?? {});
      const row = await svc.assertUsableByManual(tenantId, body.code);
      return reply.send({ usable: true, code: row.code, class: row.sourceClass });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /journal-sources?class=&status= — registry / source lookup.
  app.get('/journal-sources', { preHandler: requireSourcePermission(SOURCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { class: cls, status } = request.query as { class?: string; status?: string };
      if (cls && cls !== 'MANUAL' && cls !== 'SYSTEM') {
        return reply.status(400).send({ error: 'BAD_REQUEST', message: 'class must be MANUAL or SYSTEM' });
      }
      const rows = await svc.list(tenantId, { sourceClass: cls as any, status });
      return reply.send(rows);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /journal-sources/:code
  app.get('/journal-sources/:code', { preHandler: requireSourcePermission(SOURCE_PERMISSIONS.VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { code } = request.params as { code: string };
      return reply.send(await svc.get(tenantId, code));
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // PATCH /journal-sources/:code — reserved sources rejected (422).
  app.patch('/journal-sources/:code', { preHandler: requireSourcePermission(SOURCE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { code } = request.params as { code: string };
      const body = UpdateSchema.parse(request.body ?? {});
      const row = await svc.update({ tenantId, code, name: body.name, flags: body.flags, actor: actorOf(request, body) });
      return reply.send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /journal-sources/:code/deactivate
  app.post('/journal-sources/:code/deactivate', { preHandler: requireSourcePermission(SOURCE_PERMISSIONS.MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { code } = request.params as { code: string };
      const row = await svc.deactivate(tenantId, code, actorOf(request, request.body));
      return reply.send(row);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

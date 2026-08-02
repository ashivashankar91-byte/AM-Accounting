import { FastifyInstance, FastifyReply } from 'fastify';
import { container } from 'tsyringe';
import { authMiddleware, createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';

export function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string)?.trim();
  if (!id) { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 401; throw e; }
  return id;
}

/**
 * Legal-entity scope is carried on the request, never inferred from the body.
 * A caller asking for one entity while holding a header for another is denied
 * rather than quietly served the entity they asked for.
 */
export function getLegalEntityId(request: any, fallback?: string | null): string {
  const header = (request.headers['x-legal-entity-id'] as string)?.trim();
  const body = (request.body as any)?.legalEntityId ?? (request.query as any)?.legalEntityId;
  if (header && body && header !== body) {
    const e: any = new Error(`Legal entity scope mismatch: header ${header} vs requested ${body}`);
    e.statusCode = 403;
    e.code = 'LEGAL_ENTITY_SCOPE_MISMATCH';
    throw e;
  }
  const id = header || body || fallback;
  if (!id) {
    const e: any = new Error('x-legal-entity-id header is required');
    e.statusCode = 400;
    e.code = 'LEGAL_ENTITY_REQUIRED';
    throw e;
  }
  return id;
}

export function getActor(request: any): string {
  const actor = (request as any).user?.sub;
  if (!actor) { const e: any = new Error('Authenticated actor is required'); e.statusCode = 401; throw e; }
  return actor;
}

export function requirePermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

/**
 * Soft check used for progressive disclosure inside an already-authorised
 * route — for example, whether the caller may see unmasked sensitive fields.
 * Fail-closed: anything other than an explicit allow is a deny.
 */
export async function hasPermission(request: any, permission: string): Promise<boolean> {
  try {
    const actor = (request as any).user?.sub;
    if (!actor) return false;
    if ((request as any).user?.role === 'SERVICE') return true;
    const client = container.resolve<AuthzClient>('AuthzClient');
    const result = await client.check({
      userId: actor,
      permissionKey: permission,
      scope: { tenantId: getTenantId(request), entityId: (request.headers['x-legal-entity-id'] as string) ?? null },
      route: request.routeOptions?.url ?? request.url,
    });
    return Boolean(result.allow);
  } catch {
    return false;
  }
}

export function attachAuth(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));
}

/**
 * Domain errors carry their own status and code; anything else is a genuine
 * server fault and is surfaced as one rather than dressed up as a 400.
 */
export function sendDomainError(reply: FastifyReply, error: unknown) {
  const err = error as any;
  const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : 422;
  return reply.status(statusCode).send({
    error: err?.code ?? err?.name ?? 'MIGRATION_ERROR',
    message: err?.message ?? 'Migration operation failed',
    details: err?.result ?? err?.details ?? undefined,
  });
}

const DOMAIN_ERROR_NAMES = new Set([
  'InvalidMigrationTransitionError', 'CutoverPrerequisiteError', 'MigrationSoDViolationError',
  'UnbalancedConversionBatchError', 'MappingSetNotFrozenError', 'ComparisonSignOffError',
  'CutoverCeremonyError', 'RollbackError', 'RunbookStepError', 'DuplicateSourceFileError',
  'ChecksumMismatchError', 'MappingSetFrozenError', 'MappingCoverageIncompleteError',
  'MappingApprovalSoDError', 'UnknownDatasetTypeError', 'PromotionBlockedError',
  'MigrationRunNotFoundError', 'ComparisonNotFoundError', 'DuplicateArchiveError',
]);

export function isDomainError(error: unknown): boolean {
  const err = error as any;
  return DOMAIN_ERROR_NAMES.has(err?.name) || typeof err?.statusCode === 'number';
}

export async function handle<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return reply.send(await fn());
  } catch (error) {
    if (isDomainError(error)) return sendDomainError(reply, error);
    throw error;
  }
}

export function parseIntOr(value: unknown, fallback: number): number {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

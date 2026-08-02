import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AuthzClient, TenantId, asTenantId, createAuthzGuard } from '@amacc/shared-kernel';
import type { PrismaClient } from '.prisma/posting-recovery-client';
import { appendAuditReference } from '../infrastructure/audit';

// Mirrors services/gl-service/src/http/security.ts's module.resource.action
// convention (see PO-DEC-004-adjacent precedent) — dash instead of dot in
// the module segment only because the service/permission catalog migration
// (services/auth-service/prisma/migrations/20260729030000_extend_authz_catalog_s021_posting_recovery)
// already defines these five keys with the "posting-recovery." prefix.
export const POSTING_RECOVERY_PERMISSIONS = {
  QUEUE_READ: 'posting-recovery.queue.read',
  CASE_READ: 'posting-recovery.case.read',
  PAYLOAD_READ: 'posting-recovery.payload.read',
  PAYLOAD_READ_SENSITIVE: 'posting-recovery.payload.read-sensitive',
  AUDIT_READ: 'posting-recovery.audit.read',
  /// R1 S021-completion slice — see
  /// services/auth-service/prisma/migrations/20260730020000_extend_authz_catalog_s021_posting_recovery_replay.
  REPLAY_EXECUTE: 'posting-recovery.replay.execute',
  /// CE-07/S023 (D-S023-23) — real case intake from coa-service's posting
  /// engine. See services/auth-service/prisma/migrations/20260801030000_extend_authz_catalog_s023_case_intake.
  CASE_CREATE: 'posting-recovery.case.create',
} as const;

export function getTenantId(request: any, statusCode = 400): TenantId {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    const err: any = new Error('Missing required header: x-tenant-id');
    err.statusCode = statusCode;
    throw err;
  }
  return asTenantId(tenantId);
}

export function getActor(request: any): string {
  return (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'system';
}

/**
 * Non-blocking permission check for route handlers that need to shape a
 * response differently by permission (e.g. payload masking) rather than
 * deny the whole route. Fails closed on any authz-client error, same as
 * createAuthzGuard.
 */
export async function hasPermission(request: any, permission: string): Promise<boolean> {
  const userId = request.user?.sub as string | undefined;
  if (!userId) return false;
  const tenantId = getTenantId(request);
  const client = container.resolve<AuthzClient>('AuthzClient');
  const result = await client.check({
    userId,
    permissionKey: permission,
    scope: { tenantId },
    route: request.routeOptions?.url ?? request.routerPath ?? request.url,
  });
  return result.allow;
}

export interface RouteAuditSpec {
  eventType: string;
  deadLetterId?: (request: any) => string | null;
}

function normalizeRouteUrl(rawUrl: unknown): string {
  const routeUrl = String(rawUrl ?? '').replace(/^\/posting-recovery\/v1/, '');
  return routeUrl || '/';
}

/**
 * Wires permission enforcement (per-route, deny-by-default via
 * resolvePermission) and read-auditing (per-route, via resolveAudit) —
 * mirrors services/gl-service/src/http/security.ts's attachRouteSecurity
 * exactly, adapted to this service's audit outbox
 * (posting_recovery_audit_reference).
 */
export function attachRouteSecurity(
  app: FastifyInstance,
  prisma: PrismaClient,
  resolvePermission: (method: string, url: string) => string | null,
  resolveAudit: (method: string, url: string) => RouteAuditSpec | null,
  missingTenantStatusCode = 400,
): void {
  const requirePermission = createAuthzGuard(
    container.resolve<AuthzClient>('AuthzClient'),
    { getTenantId: (request: any) => getTenantId(request, missingTenantStatusCode) },
  );

  app.addHook('preHandler', async (request: any, reply: any) => {
    const rawRouteUrl = request.routeOptions?.url ?? request.routerPath ?? request.url?.split('?')[0] ?? '';
    const routeUrl = normalizeRouteUrl(rawRouteUrl);
    const permission = resolvePermission(String(request.method), String(routeUrl));
    if (!permission) return;
    return requirePermission(permission)(request, reply);
  });

  app.addHook('onRoute', (routeOptions: any) => {
    const method = Array.isArray(routeOptions.method) ? String(routeOptions.method[0]) : String(routeOptions.method);
    const routeUrl = normalizeRouteUrl(routeOptions.url);
    const audit = resolveAudit(method, routeUrl);
    if (!audit || typeof routeOptions.handler !== 'function') return;

    const original = routeOptions.handler;
    routeOptions.handler = async function auditedHandler(this: unknown, request: any, reply: any) {
      const result = await original.call(this, request, reply);
      if ((reply.statusCode ?? 200) < 400) {
        const tenantId = getTenantId(request, missingTenantStatusCode);
        await appendAuditReference(prisma, {
          tenantId,
          deadLetterId: audit.deadLetterId?.(request) ?? null,
          eventType: audit.eventType,
          actor: getActor(request),
          after: {
            route: routeUrl,
            method,
            params: request.params ?? {},
            query: request.query ?? {},
            statusCode: reply.statusCode ?? 200,
          },
        });
      }
      return result;
    };
  });
}

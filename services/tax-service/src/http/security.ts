import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AuthzClient, asTenantId, createAuthzGuard, TenantId } from '@amacc/shared-kernel';

/**
 * S207 manifest — see
 * services/auth-service/prisma/migrations/20260801020000_add_ce10_tax_permissions/migration.sql
 * for the additive permission-catalog migration these keys map to.
 */
export const TAX_PERMISSIONS = {
  CONFIG_VIEW: 'tax.config.view',
  CONFIG_MANAGE: 'tax.config.manage',
  RESULT_VIEW: 'tax.result.view',
  EXCEPTION_VIEW: 'tax.exception.view',
  EXCEPTION_DISPOSITION: 'tax.exception.disposition',
  RECONCILIATION_VIEW: 'tax.reconciliation.view',
  FEE_VIEW: 'tax.fee.view',
  FEE_MANAGE: 'tax.fee.manage',
  EXEMPTION_VIEW: 'tax.exemption.view',
  EXEMPTION_MANAGE: 'tax.exemption.manage',
  JURISDICTION_VIEW: 'tax.jurisdiction.view',
  JURISDICTION_MANAGE: 'tax.jurisdiction.manage',
  ADAPTER_VIEW: 'tax.adapter.view',
  ADAPTER_MANAGE: 'tax.adapter.manage',
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
 * Legal-entity scope resolution. No repo-wide `x-legal-entity-id` header
 * convention existed prior to CE-10 (the frontend's ContextBar tracks the
 * selected entity client-side only) — this reads it from an explicit query
 * param or request body first (screens that pass it explicitly win), then
 * falls back to the `x-legal-entity-id` header the web client now sends on
 * every request (see apps/web/src/api/client.ts apiFetch), so callers never
 * have to thread legalEntityId through every list call by hand.
 */
export function getLegalEntityId(request: any): string | undefined {
  const fromQuery = (request.query as any)?.legalEntityId;
  const fromBody = (request.body as any)?.legalEntityId;
  const fromHeader = request.headers?.['x-legal-entity-id'] as string | undefined;
  return fromQuery || fromBody || fromHeader || undefined;
}

/** Wires per-route permission enforcement — mirrors
 * services/posting-recovery-service/src/http/security.ts's
 * attachRouteSecurity permission-hook half (audit is written per-service by
 * each application-layer call, not via a generic onRoute wrapper here,
 * since most tax-service writes are multi-step and already audited inline). */
export function attachRouteSecurity(
  app: FastifyInstance,
  resolvePermission: (method: string, url: string) => string | null,
  missingTenantStatusCode = 400,
): void {
  const requirePermission = createAuthzGuard(
    container.resolve<AuthzClient>('AuthzClient'),
    { getTenantId: (request: any) => getTenantId(request, missingTenantStatusCode) },
  );

  app.addHook('preHandler', async (request: any, reply: any) => {
    const rawRouteUrl = request.routeOptions?.url ?? request.routerPath ?? request.url?.split('?')[0] ?? '';
    const routeUrl = String(rawRouteUrl).replace(/^\/api\/v1\/tax/, '') || '/';
    const permission = resolvePermission(String(request.method), routeUrl);
    if (!permission) return;
    return requirePermission(permission)(request, reply);
  });
}

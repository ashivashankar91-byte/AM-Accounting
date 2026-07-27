import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AuthzClient, TenantId, asTenantId, createAuthzGuard } from '@amacc/shared-kernel';
import type { PrismaClient } from '.prisma/gl-client';
import { appendAuditRows } from '../infrastructure/audit';

export const GL_PERMISSIONS = {
  DASHBOARD_VIEW: 'gl.dashboard.view',
  LEDGER_VIEW: 'gl.ledger.view',
  LEDGER_MANAGE: 'gl.ledger.manage',
  ADMIN_MANAGE: 'gl.admin.manage',
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

export interface RouteAuditSpec {
  docType: string;
  action?: 'VIEWED' | 'EXPORTED';
  docId?: (request: any) => string;
}

export function attachRouteSecurity(
  app: FastifyInstance,
  prisma: PrismaClient,
  resolvePermission: (method: string, url: string) => string | null,
  resolveAudit: (method: string, url: string) => RouteAuditSpec | null,
  missingTenantStatusCode = 400,
): void {
  const requirePermission = createAuthzGuard(
    container.resolve<AuthzClient>('AuthzClient'),
    { getTenantId: (request) => getTenantId(request, missingTenantStatusCode) },
  );

  app.addHook('preHandler', async (request: any, reply: any) => {
    const rawRouteUrl = request.routeOptions?.url ?? request.routerPath ?? request.url?.split('?')[0] ?? '';
    const routeUrl = String(rawRouteUrl).replace(/^\/api\/v1\/gl/, '') || '/';
    const permission = resolvePermission(String(request.method), String(routeUrl));
    if (!permission) return;
    return requirePermission(permission)(request, reply);
  });

  app.addHook('onRoute', (routeOptions: any) => {
    const method = Array.isArray(routeOptions.method) ? String(routeOptions.method[0]) : String(routeOptions.method);
    const audit = resolveAudit(method, routeOptions.url);
    if (!audit || typeof routeOptions.handler !== 'function') return;

    const original = routeOptions.handler;
    routeOptions.handler = async function auditedHandler(this: unknown, request: any, reply: any) {
      const result = await original.call(this, request, reply);
      if ((reply.statusCode ?? 200) < 400) {
        const tenantId = getTenantId(request, missingTenantStatusCode);
        await appendAuditRows(prisma as any, {
          tenantId,
          docType: audit.docType,
          docId: audit.docId?.(request) ?? routeOptions.url,
          action: audit.action ?? 'VIEWED',
          actor: getActor(request),
          after: {
            route: routeOptions.url,
            method,
            params: request.params ?? {},
            query: request.query ?? {},
            statusCode: reply.statusCode ?? 200,
          },
          eventType: audit.action === 'EXPORTED' ? 'audit.exported' : 'audit.viewed',
        });
      }
      return result;
    };
  });
}

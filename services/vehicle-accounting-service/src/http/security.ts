import { container } from 'tsyringe';
import { createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';

// CLAUDE.md rule #3 / CE-12 GLOBAL RULES (tenant+LE+store isolation): every
// route requires x-tenant-id — 400 (not 401) when missing, same convention
// as coa-service's account-routes.ts/posting-engine-routes.ts.
export function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export function getActor(request: any, body?: any): string {
  return (body?.actor as string | undefined) ?? (request.user?.sub as string | undefined) ?? 'system';
}

// ── Authorization (deny-by-default, centralized through S207) ──────────────
// dot-namespaced, mirrors coa-service's POSTING_ENGINE_PERMISSIONS /
// posting-recovery-service's POSTING_RECOVERY_PERMISSIONS naming style.
export const VEHICLE_ACCOUNTING_PERMISSIONS = {
  UNIT_VIEW: 'vehicle_accounting.unit.view',
  UNIT_STOCK_IN: 'vehicle_accounting.unit.stock_in',
  UNIT_COST_ADD: 'vehicle_accounting.unit.cost_add',
  UNIT_RECLASS: 'vehicle_accounting.unit.reclass',
  UNIT_WRITEDOWN: 'vehicle_accounting.unit.writedown',
  DEMO_ADJUSTMENT_APPROVE: 'vehicle_accounting.demo_adjustment.approve',
  DEALER_TRADE_VIEW: 'vehicle_accounting.dealer_trade.view',
  DEALER_TRADE_MANAGE: 'vehicle_accounting.dealer_trade.manage',
  CONFIG_MANAGE: 'vehicle_accounting.config.manage',
} as const;

export function requireVehicleAccountingPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

export function handleError(error: unknown, reply: any) {
  const err = error as any;
  if (typeof err?.status === 'number' && typeof err?.code === 'string') {
    return reply.status(err.status).send({ error: err.code, message: err.message });
  }
  if (err?.name === 'ZodError' || err?.issues) {
    return reply.status(400).send({ error: 'VALIDATION_ERROR', issues: err.issues });
  }
  if (err?.statusCode === 400) {
    return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
  }
  throw error;
}

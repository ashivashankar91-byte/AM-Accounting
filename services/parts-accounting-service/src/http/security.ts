import { container } from 'tsyringe';
import { createAuthzGuard, AuthzClient } from '@amacc/shared-kernel';

export function getTenantId(request: any): string {
  const id = (request.headers['x-tenant-id'] as string | undefined)?.trim();
  if (!id) {
    const e: any = new Error('x-tenant-id header is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

/** Every read/write below is legal-entity scoped at the application layer
 * (RLS here is tenant_id-keyed only, by established repo convention — see
 * the RLS migration's own comment) — so legalEntityId is REQUIRED wherever
 * a single record is looked up by id/business-key, never optional/defaulted,
 * exactly like x-tenant-id above. `source` is whatever the route already
 * extracted (req.query for GETs, req.body for POSTs). */
export function requireLegalEntityId(source: Record<string, unknown> | undefined | null): string {
  const id = typeof source?.['legalEntityId'] === 'string' ? (source['legalEntityId'] as string).trim() : '';
  if (!id) {
    const e: any = new Error('legalEntityId is required');
    e.statusCode = 400;
    throw e;
  }
  return id;
}

export const PARTS_PERMISSIONS = {
  MOVEMENT_VIEW: 'parts.movement.view',
  MOVEMENT_POST: 'parts.movement.post',
  RECONCILIATION_VIEW: 'parts.reconciliation.view',
  RECONCILIATION_RUN: 'parts.reconciliation.run',
  VALUATION_VIEW: 'parts.valuation.view',
  VALUATION_MANAGE: 'parts.valuation.manage',
  PRICETAPE_VIEW: 'parts.pricetape.view',
  PRICETAPE_APPROVE: 'parts.pricetape.approve',
  OBSOLESCENCE_VIEW: 'parts.obsolescence.view',
  OBSOLESCENCE_APPROVE: 'parts.obsolescence.approve',
  SCRAP_EXECUTE: 'parts.scrap.execute',
  SCRAP_VIEW: 'parts.scrap.view',
  PHYSICAL_VIEW: 'parts.physical.view',
  PHYSICAL_COUNT: 'parts.physical.count',
  PHYSICAL_APPROVE: 'parts.physical.approve',
  DEPOSIT_VIEW: 'parts.deposit.view',
  DEPOSIT_MANAGE: 'parts.deposit.manage',
  OEMRETURN_VIEW: 'parts.oemreturn.view',
  OEMRETURN_MANAGE: 'parts.oemreturn.manage',
  EXCEPTION_VIEW: 'parts.exception.view',
  EXCEPTION_MANAGE: 'parts.exception.manage',
  MAPPING_VIEW: 'parts.mapping.view',
  MAPPING_MANAGE: 'parts.mapping.manage',
} as const;

export function requirePartsPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

export function handleError(error: unknown, reply: any) {
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  const code = (error as any)?.code;
  if (status && typeof status === 'number') {
    return reply.status(status).send({ error: code ?? 'ERROR', message: (error as any).message, ...(code === 'ACCOUNT_MAPPING_VALUES_PENDING' ? { eventFamily: (error as any).eventFamily, role: (error as any).role } : {}) });
  }
  throw error;
}

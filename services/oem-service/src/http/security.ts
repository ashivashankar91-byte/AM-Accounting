import { asTenantId, TenantId } from '@amacc/shared-kernel';

/**
 * S207 manifest — see
 * services/auth-service/prisma/migrations/20260801030000_add_ce14_oem_permissions/migration.sql
 * for the additive permission-catalog migration these keys map to.
 */
export const OEM_PERMISSIONS = {
  PROFILE_VIEW: 'oem.profile.view',
  PROFILE_MANAGE: 'oem.profile.manage',
  STAGING_VIEW: 'oem.staging.view',
  STAGING_IMPORT: 'oem.staging.import',
  MATCH_VIEW: 'oem.match.view',
  MATCH_DISPOSE: 'oem.match.dispose',
  INCENTIVE_VIEW: 'oem.incentive.view',
  INCENTIVE_MANAGE: 'oem.incentive.manage',
  INCENTIVE_TRUEUP: 'oem.incentive.trueup',
  STATEMENT_VIEW: 'oem.statement.view',
  STATEMENT_RENDER: 'oem.statement.render',
  STATEMENT_MAPPING_AUTHOR: 'oem.statement.mapping.author',
  STATEMENT_MAPPING_ACTIVATE: 'oem.statement.mapping.activate',
  WARRANTY_VIEW: 'oem.warranty.view',
  WARRANTY_CHARGEBACK_DISPOSE: 'oem.warranty.chargeback.dispose',
  WARRANTY_RESERVE_MANAGE: 'oem.warranty.reserve.manage',
  COOP_VIEW: 'oem.coop.view',
  COOP_CLAIM_MANAGE: 'oem.coop.claim.manage',
  COOP_ACCRUAL_MANAGE: 'oem.coop.accrual.manage',
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

export function getStoreId(request: any): string | undefined {
  const fromQuery = (request.query as any)?.storeId;
  const fromBody = (request.body as any)?.storeId;
  const fromHeader = request.headers?.['x-store-id'] as string | undefined;
  return fromQuery || fromBody || fromHeader || undefined;
}

export function requireStoreId(request: any): string {
  const storeId = getStoreId(request);
  if (!storeId) {
    const err: any = new Error('Missing required storeId (query, body, or x-store-id header)');
    err.statusCode = 400;
    throw err;
  }
  return storeId;
}

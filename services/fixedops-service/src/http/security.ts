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

/** Every permission key here is documented in PERMISSIONS.md — see that
 * file for the ADMIN/CONTROLLER/ACCOUNTANT/WARRANTY_ADMIN grant matrix
 * (consolidated centrally into an auth-service migration alongside the
 * other CE-11 permission keys). */
export const FIXEDOPS_PERMISSIONS = {
  RO_VIEW: 'fixedops.ro.view',
  RO_CLOSE_EXECUTE: 'fixedops.ro.close.execute',
  RO_REVERSAL_EXECUTE: 'fixedops.ro.reversal.execute',
  WIP_VIEW: 'fixedops.wip.view',
  WIP_ELECT: 'fixedops.wip.elect',
  SUBLET_VIEW: 'fixedops.sublet.view',
  SUBLET_MANAGE: 'fixedops.sublet.manage',
  TECHTIME_POST: 'fixedops.techtime.post',
  TECHTIME_VIEW: 'fixedops.techtime.view',
  TECHTIME_REVERSE: 'fixedops.techtime.reverse',
  LABOR_RATE_VIEW: 'fixedops.laborrate.view',
  LABOR_RATE_MANAGE: 'fixedops.laborrate.manage',
  DEFERRED_VIEW: 'fixedops.deferred.view',
  DEFERRED_MANAGE: 'fixedops.deferred.manage',
  WARRANTY_VIEW: 'fixedops.warranty.view',
  WARRANTY_DISPOSITION: 'fixedops.warranty.disposition',
  MAPPING_VIEW: 'fixedops.mapping.view',
  MAPPING_MANAGE: 'fixedops.mapping.manage',
  EXCEPTION_VIEW: 'fixedops.exception.view',
  EXCEPTION_RESOLVE: 'fixedops.exception.resolve',
  AUDIT_VIEW: 'fixedops.audit.view',
} as const;

export function requireFixedOpsPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId })(permission);
}

export function handleError(error: unknown, reply: any) {
  const err = error as any;
  if (err?.name === 'NotFoundError') return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
  if (err?.name === 'AccountMappingPendingError') return reply.status(422).send({ error: 'ACCOUNT_MAPPING_PENDING', message: err.message, tenantId: err.tenantId, legalEntityId: err.legalEntityId, eventFamily: err.eventFamily, role: err.role });
  if (err?.name === 'TaxResultUnavailableError') return reply.status(422).send({ error: 'TAX_RESULT_UNAVAILABLE', message: err.message, parkedExceptionId: err.parkedExceptionId });
  if (err?.name === 'DistributionConservationError') return reply.status(400).send({ error: 'DISTRIBUTION_CONSERVATION_VIOLATION', message: err.message });
  if (err?.name === 'FixedOpsValidationError') return reply.status(400).send({ error: err.code ?? 'VALIDATION_ERROR', message: err.message });
  if (err?.name === 'ReversalRefusedError') return reply.status(409).send({ error: 'REVERSAL_REFUSED', refusalCode: err.refusalCode, message: err.message });
  if (err?.name === 'EventIdentityConflictError') return reply.status(409).send({ error: 'EVENT_IDENTITY_CONFLICT', message: err.message });
  if (err?.name === 'RateGapError') return reply.status(422).send({ error: 'RATE_GAP', message: err.message, tenantId: err.tenantId, legalEntityId: err.legalEntityId, techId: err.techId, deptCode: err.deptCode });
  if (err?.statusCode === 400) return reply.status(400).send({ error: 'BAD_REQUEST', message: err.message });
  throw error;
}

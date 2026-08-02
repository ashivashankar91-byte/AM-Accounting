import type { FastifyInstance } from 'fastify';
import { container } from 'tsyringe';
import { AuthzClient, createAuthzGuard } from '@amacc/shared-kernel';

/**
 * S207 manifest — see services/auth-service/prisma/migrations/
 * 20260802040000_extend_authz_catalog_ce12_deal_accounting/migration.sql
 * for the additive permission-catalog migration these keys map to.
 *
 * Tiering (per the epic package): release/unwind/recontract/dispose/
 * arbitration/payoff-issue/payoff-variance/cit-disposition are the
 * highest-risk actions (release a held posting, reverse/re-post a posted
 * journal, issue a payment-adjacent instruction, override a funding/reserve
 * variance) — ADMIN/CONTROLLER only, matching posting_engine.rule_pack.
 * activate's precedent. finalize/hold/return/cit.fund/view are broader
 * (ADMIN/CONTROLLER/ACCOUNTANT).
 */
export const DEAL_ACCOUNTING_PERMISSIONS = {
  DEAL_FINALIZE: 'deal_accounting.deal.finalize',
  DEAL_VIEW: 'deal_accounting.deal.view',
  BILLER_HOLD: 'deal_accounting.biller.hold',
  BILLER_RELEASE: 'deal_accounting.biller.release',
  BILLER_RETURN: 'deal_accounting.biller.return',
  REVIEW_VIEW: 'deal_accounting.review.view',
  UNWIND_EXECUTE: 'deal_accounting.unwind.execute',
  RECONTRACT_EXECUTE: 'deal_accounting.recontract.execute',
  CIT_FUND: 'deal_accounting.cit.fund',
  CIT_DISPOSITION: 'deal_accounting.cit.disposition',
  CIT_VIEW: 'deal_accounting.cit.view',
  PAYOFF_ISSUE: 'deal_accounting.payoff.issue',
  PAYOFF_VARIANCE_DISPOSITION: 'deal_accounting.payoff.variance_disposition',
  PAYOFF_VIEW: 'deal_accounting.payoff.view',
  WHOLESALE_DISPOSE: 'deal_accounting.wholesale.dispose',
  WHOLESALE_ARBITRATION: 'deal_accounting.wholesale.arbitration',
  WHOLESALE_VIEW: 'deal_accounting.wholesale.view',
  // Gap-closure — schedule 91 (Due-Bill/We-Owe items). Broader tier (ADMIN/
  // CONTROLLER/ACCOUNTANT), matching cit.fund/finalize precedent (this is a
  // routine intake ceremony, not a release/reversal/override action).
  DUE_BILL_RECORD: 'deal_accounting.duebill.record',
  DUE_BILL_VIEW: 'deal_accounting.duebill.view',
} as const;

export function getTenantId(request: any, statusCode = 400): string {
  const tenantId = request.headers['x-tenant-id'] as string | undefined;
  if (!tenantId || tenantId.trim() === '') {
    const err: any = new Error('Missing required header: x-tenant-id');
    err.statusCode = statusCode;
    throw err;
  }
  return tenantId.trim();
}

export function getActor(request: any): string {
  return (request as any).user?.sub ?? (request.headers['x-user-id'] as string) ?? 'system';
}

export function requireDealAccountingPermission(permission: string) {
  return createAuthzGuard(container.resolve<AuthzClient>('AuthzClient'), { getTenantId: (r: any) => getTenantId(r) })(permission);
}

export function attachTenantHeaderGuard(app: FastifyInstance): void {
  app.addHook('preHandler', async (request: any, reply: any) => {
    try {
      getTenantId(request);
    } catch (err: any) {
      return reply.status(err.statusCode ?? 400).send({ error: 'MISSING_TENANT_ID', message: err.message });
    }
  });
}

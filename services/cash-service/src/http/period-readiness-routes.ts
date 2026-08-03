// CE-15 reconciliation — period-readiness signal for close-service.
//
// Bank reconciliation readiness from cash-service covers two dimensions:
//   1. BankFeedLine items in UNMATCHED status for the period's value-date range.
//   2. SettlementWorklistItem entries in OPEN status (unresolved clearance differences).
//
// The apar-service /period-readiness endpoint explicitly covers AP/AR only.
// This endpoint covers the bank/settlement dimension so the close-service can
// require both to be clear before allowing a period hard-close. Stale or
// unavailable evidence returns NOT_READY; settlement is never fabricated.
//
// Called by close-service via UpstreamModuleClient module code 'CE09_BANK_RECON'.
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/cash-client';
import { setTenantContextOnConnection } from '@amacc/shared-kernel';

export async function cashPeriodReadinessRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required for cashPeriodReadinessRoutes');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  app.get<{
    Querystring: {
      legalEntityId?: string;
      periodYear?: string;
      periodMonth?: string;
    };
  }>('/period-readiness', async (request, reply) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    if (!tenantId) {
      return reply.status(400).send({ error: 'MISSING_TENANT', message: 'x-tenant-id header is required' });
    }

    const { legalEntityId, periodYear, periodMonth } = request.query;
    const blockers: string[] = [];

    if (!periodYear || !periodMonth) {
      // Without a period range we cannot evaluate bank-feed staleness; return
      // NOT_READY so the caller cannot skip this check by omitting parameters.
      return reply.status(200).send({
        signal: 'NOT_READY',
        blockers: ['periodYear and periodMonth are required for bank-reconciliation readiness'],
      });
    }

    const year  = parseInt(periodYear,  10);
    const month = parseInt(periodMonth, 10);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return reply.status(400).send({ error: 'INVALID_PERIOD', message: 'periodYear and periodMonth must be valid integers' });
    }

    // Build the value-date range for the period [first day, last day inclusive].
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd   = new Date(year, month, 0);   // last day of month

    const prisma = new PrismaClient();
    try {
      await setTenantContextOnConnection(prisma, tenantId);

      // 1. Unmatched bank-feed lines for the period.
      const unmatchedBankLines = await prisma.bankFeedLine.count({
        where: {
          tenantId,
          status: 'UNMATCHED',
          valueDate: { gte: periodStart, lte: periodEnd },
        },
      });
      if (unmatchedBankLines > 0) {
        blockers.push(
          `${unmatchedBankLines} bank feed line(s) are UNMATCHED for period ${year}-${String(month).padStart(2, '0')}`,
        );
      }

      // 2. Open settlement worklist items (clearing differences not yet resolved).
      const openSettlementItems = await prisma.settlementWorklistItem.count({
        where: {
          tenantId,
          status: 'OPEN',
          // Only items updated within or before this period — items created
          // after the period end are next-period concern.
          createdAt: { lte: periodEnd },
        },
      });
      if (openSettlementItems > 0) {
        blockers.push(
          `${openSettlementItems} settlement worklist item(s) are OPEN and require resolution`,
        );
      }

      // 3. Cash drawers for the period that were never reconciled (by entity scope).
      const cashDrawerWhere: Record<string, unknown> = {
        tenantId,
        status: { not: 'RECONCILED' },
        openedAt: { gte: periodStart, lte: periodEnd },
      };
      if (legalEntityId) cashDrawerWhere['entityId'] = legalEntityId;

      const unreconciledDrawers = await prisma.cashDrawer.count({ where: cashDrawerWhere as any });
      if (unreconciledDrawers > 0) {
        blockers.push(
          `${unreconciledDrawers} cash drawer(s) opened in period ${year}-${String(month).padStart(2, '0')} are not yet RECONCILED`,
        );
      }
    } finally {
      await prisma.$disconnect();
    }

    const signal = blockers.length === 0 ? 'READY' : 'NOT_READY';
    return reply.status(200).send({ signal, blockers });
  });
}

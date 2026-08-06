// CE-15 reconciliation — period-readiness signal for close-service.
//
// Signal logic (CE-09 AP/AR/cash/bank):
//   NOT_READY if any APEntry has status='PENDING_MANUAL' (uninvoiced AP
//             outstanding — manual clearing required before close).
//   NOT_READY if any AREntry has status='OPEN' with dueDate in the period
//             (open receivables not yet posted/resolved).
//   READY     otherwise.
//
// Note: status='OPEN' on APEntry is normal until paid; PENDING_MANUAL is
// the explicit blocking state (requires accountant action to clear).
// Bank reconciliation readiness is tracked by the cash-service; this signal
// covers AP/AR only.
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/apar-client';

export async function aparPeriodReadinessRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  app.get<{
    Querystring: { legalEntityId?: string; periodYear?: string; periodMonth?: string };
  }>('/period-readiness', async (request, reply) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    if (!tenantId) return reply.status(400).send({ error: 'MISSING_TENANT', message: 'x-tenant-id required' });

    const { periodYear, periodMonth } = request.query;
    const blockers: string[] = [];
    const prisma = new PrismaClient();

    try {
      // AP: any item requiring manual accountant clearing blocks close.
      const pendingManualAP = await prisma.aPEntry.count({
        where: { tenantId, status: 'PENDING_MANUAL' },
      });
      if (pendingManualAP > 0) {
        blockers.push(`${pendingManualAP} AP invoice(s) status=PENDING_MANUAL require manual clearing`);
      }

      // AR: open items whose dueDate falls in the period.
      if (periodYear && periodMonth) {
        const year = parseInt(periodYear, 10);
        const month = parseInt(periodMonth, 10);
        const periodStart = new Date(year, month - 1, 1);
        const periodEnd = new Date(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1);

        const openAR = await prisma.aREntry.count({
          where: { tenantId, status: 'OPEN', dueDate: { gte: periodStart, lt: periodEnd } },
        });
        if (openAR > 0) {
          blockers.push(`${openAR} AR item(s) status=OPEN in the period`);
        }
      }
    } finally {
      await prisma.$disconnect();
    }

    const signal = blockers.length === 0 ? 'READY' : 'NOT_READY';
    return reply.status(200).send({ signal, blockers });
  });
}

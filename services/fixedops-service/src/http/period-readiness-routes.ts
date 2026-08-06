// CE-15 reconciliation — period-readiness signal for close-service.
//
// Signal logic (CE-11 Fixed Ops):
//   NOT_READY if any RepairOrder is OPEN (unprocessed ROs cannot be included
//             in a closed period — close-process requires all ROs finalized).
//   NOT_READY if any FixedOpsPostingException is in a blocking state
//             (status not in RESOLVED | DISMISSED).
//   READY     otherwise.
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/fixedops-client';

const FIXEDOPS_BLOCKING_EXCEPTION_STATUSES = ['OPEN'];

export async function fixedopsPeriodReadinessRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('AMACC_JWT_SECRET is required');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  app.get<{
    Querystring: { legalEntityId?: string; periodYear?: string; periodMonth?: string };
  }>('/period-readiness', async (request, reply) => {
    const tenantId = (request.headers['x-tenant-id'] as string | undefined)?.trim();
    if (!tenantId) return reply.status(400).send({ error: 'MISSING_TENANT', message: 'x-tenant-id required' });

    const blockers: string[] = [];
    const prisma = new PrismaClient();

    try {
      const openROs = await prisma.repairOrder.count({
        where: { tenantId, status: 'OPEN' },
      });
      if (openROs > 0) {
        blockers.push(`${openROs} repair order(s) still OPEN`);
      }

      const blockingExceptions = await prisma.fixedOpsPostingException.count({
        where: { tenantId, status: { in: FIXEDOPS_BLOCKING_EXCEPTION_STATUSES } },
      });
      if (blockingExceptions > 0) {
        blockers.push(`${blockingExceptions} Fixed Ops posting exception(s) require resolution`);
      }
    } finally {
      await prisma.$disconnect();
    }

    const signal = blockers.length === 0 ? 'READY' : 'NOT_READY';
    return reply.status(200).send({ signal, blockers });
  });
}

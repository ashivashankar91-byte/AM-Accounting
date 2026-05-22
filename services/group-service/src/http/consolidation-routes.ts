/**
 * @module ConsolidationRoutes
 * @cobol-ancestry consolgl.cbl, consolexpgl.cbl
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '@amacc/shared-kernel';
import { ConsolidationService, ConsolidationConfigNotFoundError } from '../application/consolidation-service';

export function consolidationRoutes(consolidationService: ConsolidationService) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
    if (!JWT_SECRET) {
      throw new Error('FATAL: AMACC_JWT_SECRET is not set');
    }
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // GET /:groupId/consolidated-gl — status
    app.get('/:groupId/consolidated-gl', async (request, reply) => {
      const { groupId } = request.params as { groupId: string };
      const status = await consolidationService.getStatus(groupId);
      if (!status) return reply.status(404).send({ error: 'No consolidated GL config found for this group' });
      return reply.send(status);
    });

    // POST /:groupId/consolidated-gl/clear — wipe consolidated data
    // @cobol-origin consolgl.cbl Option 1
    app.post('/:groupId/consolidated-gl/clear', async (request, reply) => {
      const { groupId } = request.params as { groupId: string };
      const result = await consolidationService.clear(groupId);
      return reply.send(result);
    });

    // POST /:groupId/consolidated-gl/import — build account mapping (live fan-out; no data copy)
    // @cobol-origin consolgl.cbl Option 2 + consolexpgl.cbl
    app.post('/:groupId/consolidated-gl/import', async (request, reply) => {
      const { groupId } = request.params as { groupId: string };

      const body = z.object({
        companies: z.array(z.string().min(1)).min(2).max(40),
        lastClosedDate: z.string().regex(/^\d{8}$/, 'lastClosedDate must be YYYYMMDD'),
        consolidatedTenantId: z.string().min(1).optional(),
      }).parse(request.body);

      const result = await consolidationService.import(groupId, body);
      return reply.send(result);
    });

    // GET /:groupId/consolidated-gl/trial-balance — live fan-out trial balance
    // @architecture Queries each source tenant's gl-service in real-time; no data copy.
    app.get('/:groupId/consolidated-gl/trial-balance', async (request, reply) => {
      const { groupId } = request.params as { groupId: string };
      const query = z.object({
        periodYear: z.coerce.number().int().min(2000).max(2100),
        periodMonth: z.coerce.number().int().min(1).max(13),
      }).parse(request.query);

      try {
        const lines = await consolidationService.getConsolidatedTrialBalance(
          groupId,
          query.periodYear,
          query.periodMonth,
        );
        return reply.send({ lines, count: lines.length });
      } catch (err) {
        if (err instanceof ConsolidationConfigNotFoundError) {
          return reply.status(404).send({ error: err.message });
        }
        throw err;
      }
    });
  };
}

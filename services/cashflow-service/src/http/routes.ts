import { FastifyInstance } from 'fastify';
import { CashFlowService } from '../application/cashflow-service';
import { authMiddleware } from '@amacc/shared-kernel';

export function cashflowRoutes(cashflowService: CashFlowService) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
    if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required. cashflow-service cannot start without it.');
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // GET /api/v1/cashflow/forecast
    app.get('/forecast', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      try {
        const forecast = await cashflowService.generateForecast(tenantId);
        return reply.send(forecast);
      } catch (err: any) {
        if (err.message?.startsWith('GL_SERVICE_UNAVAILABLE')) {
          return reply.status(503).send({ error: 'GL_SERVICE_UNAVAILABLE', message: 'Cannot compute cash flow forecast without GL trial balance data' });
        }
        throw err;
      }
    });

    // GET /api/v1/cashflow/actuals
    app.get('/actuals', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const actuals = await cashflowService.getActuals(tenantId);
      return reply.send(actuals);
    });

    // GET /api/v1/cashflow/latest
    app.get('/latest', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const forecasts = await cashflowService.getLatestForecasts(tenantId);
      return reply.send(forecasts);
    });
  };
}

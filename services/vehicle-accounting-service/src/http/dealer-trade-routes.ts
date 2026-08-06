import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { DealerTradeService } from '../application/dealer-trade-service';
import { getTenantId, getActor, requireVehicleAccountingPermission, handleError, VEHICLE_ACCOUNTING_PERMISSIONS as PERM } from './security';

const OutboundSchema = z.object({
  tradeNumber: z.string().min(1),
  entityId: z.string().min(1),
  storeId: z.string().min(1),
  counterpartyDealer: z.string().min(1),
  stockNumber: z.string().min(1),
  agreedValue: z.string().min(1),
  eventId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
});

const InboundSchema = z.object({
  tradeNumber: z.string().min(1),
  entityId: z.string().min(1),
  storeId: z.string().min(1),
  counterpartyDealer: z.string().min(1),
  stockNumber: z.string().min(1),
  vin: z.string().min(1),
  status: z.enum(['NEW', 'USED', 'DEMO', 'WHOLESALE']),
  acv: z.string().min(1),
  eventId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
});

const SettleSchema = z.object({
  eventId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  cashDifferenceNote: z.string().optional(),
  actor: z.string().min(1).optional(),
});

export async function dealerTradeRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve(DealerTradeService);

  // POST /dealer-trades/outbound — S077 unit leaves at agreed value.
  app.post('/dealer-trades/outbound', { preHandler: requireVehicleAccountingPermission(PERM.DEALER_TRADE_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = OutboundSchema.parse(request.body ?? {});
      const result = await svc.outbound(tenantId, getActor(request, body), body);
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /dealer-trades/inbound — S077 unit arrives, born at ACV.
  app.post('/dealer-trades/inbound', { preHandler: requireVehicleAccountingPermission(PERM.DEALER_TRADE_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = InboundSchema.parse(request.body ?? {});
      const result = await svc.inbound(tenantId, getActor(request, body), body);
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /dealer-trades/:tradeNumber/settle — S077 settlement nets receivable/payable; cash diff is CE-09 (PENDING).
  app.post('/dealer-trades/:tradeNumber/settle', { preHandler: requireVehicleAccountingPermission(PERM.DEALER_TRADE_MANAGE) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { tradeNumber } = request.params as { tradeNumber: string };
      const body = SettleSchema.parse(request.body ?? {});
      const result = await svc.settle(tenantId, getActor(request, body), { tradeNumber, ...body });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/dealer-trades', { preHandler: requireVehicleAccountingPermission(PERM.DEALER_TRADE_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string | undefined>;
      const items = await svc.listTrades(tenantId, { tradeNumber: q['tradeNumber'], status: q['status'], direction: q['direction'] });
      return reply.send({ items });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  app.get('/dealer-trades/:tradeNumber', { preHandler: requireVehicleAccountingPermission(PERM.DEALER_TRADE_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { tradeNumber } = request.params as { tradeNumber: string };
      const result = await svc.getTrade(tenantId, tradeNumber);
      return reply.send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

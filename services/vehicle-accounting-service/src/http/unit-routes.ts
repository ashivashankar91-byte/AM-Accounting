import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { container } from 'tsyringe';
import { authMiddleware } from '@amacc/shared-kernel';
import { VehicleUnitService } from '../application/vehicle-unit-service';
import { getTenantId, getActor, requireVehicleAccountingPermission, handleError, VEHICLE_ACCOUNTING_PERMISSIONS as PERM } from './security';

const StockInSchema = z.object({
  eventId: z.string().min(1),
  correlationId: z.string().min(1).optional(),
  occurredAt: z.string().datetime().optional(),
  businessDate: z.string().min(1).optional(),
  stockNumber: z.string().min(1),
  vin: z.string().min(1),
  entityId: z.string().min(1),
  storeId: z.string().min(1),
  status: z.enum(['NEW', 'USED', 'DEMO', 'WHOLESALE']),
  acquisitionType: z.enum(['PURCHASE', 'TRADE_IN', 'DEALER_TRADE_IN', 'FACTORY_RECEIPT']),
  invoiceCost: z.string().min(1),
  transportCost: z.string().optional(),
  packCost: z.string().optional(),
  packRole: z.enum(['PACK_INCOME', 'HOLDBACK_CLEARING']).optional(),
  equipmentCost: z.string().optional(),
  actor: z.string().min(1).optional(),
});

const AddCostComponentSchema = z.object({
  eventId: z.string().min(1),
  correlationId: z.string().min(1).optional(),
  occurredAt: z.string().datetime().optional(),
  businessDate: z.string().min(1).optional(),
  componentType: z.enum(['TRANSPORT', 'PACK', 'EQUIPMENT']),
  amount: z.string().min(1),
  packRole: z.enum(['PACK_INCOME', 'HOLDBACK_CLEARING']).optional(),
  actor: z.string().min(1).optional(),
});

const AddReconCostSchema = z.object({
  eventId: z.string().min(1),
  correlationId: z.string().min(1).optional(),
  occurredAt: z.string().datetime().optional(),
  businessDate: z.string().min(1).optional(),
  roNumber: z.string().min(1),
  amount: z.string().min(1),
  actor: z.string().min(1).optional(),
});

export async function unitRoutes(app: FastifyInstance) {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');
  app.addHook('preHandler', authMiddleware(JWT_SECRET));

  const svc = container.resolve(VehicleUnitService);

  // POST /units/stock-in — S074 trigger: vehicle.stocked (purchase, trade-in, dealer-trade-in, factory receipt).
  app.post('/units/stock-in', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_STOCK_IN) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const body = StockInSchema.parse(request.body ?? {});
      const result = await svc.stockIn(tenantId, getActor(request, body), body);
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /units/:stockNumber/cost-components — S074 post-stock-in transport/pack/equipment additions.
  app.post('/units/:stockNumber/cost-components', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_COST_ADD) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { stockNumber } = request.params as { stockNumber: string };
      const body = AddCostComponentSchema.parse(request.body ?? {});
      const result = await svc.addCostComponent(tenantId, getActor(request, body), { ...body, stockNumber });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // POST /units/:stockNumber/recon-cost — S074 vehicle.recon-cost-added.v1
  // (CE-11 boundary; PENDING_UPSTREAM_TECHNICAL_RECONCILIATION — see
  // application/vehicle-unit-service.ts's AddReconCostInput doc comment).
  app.post('/units/:stockNumber/recon-cost', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_COST_ADD) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { stockNumber } = request.params as { stockNumber: string };
      const body = AddReconCostSchema.parse(request.body ?? {});
      const result = await svc.addReconCost(tenantId, getActor(request, body), { ...body, stockNumber });
      return reply.status(result.idempotent ? 200 : 201).send(result);
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /units — list + filter (future UI: /accounting/vehicles/units).
  app.get('/units', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const q = request.query as Record<string, string | undefined>;
      const units = await svc.listUnits(tenantId, { entityId: q['entityId'], storeId: q['storeId'], status: q['status'], stockNumber: q['stockNumber'], vin: q['vin'] });
      return reply.send({ items: units });
    } catch (err) {
      return handleError(err, reply);
    }
  });

  // GET /units/:idOrStockNumber — unit detail: cost buildup lineage + item tie-out.
  app.get('/units/:idOrStockNumber', { preHandler: requireVehicleAccountingPermission(PERM.UNIT_VIEW) }, async (request, reply) => {
    try {
      const tenantId = getTenantId(request);
      const { idOrStockNumber } = request.params as { idOrStockNumber: string };
      const detail = await svc.getUnit(tenantId, idOrStockNumber);
      return reply.send(detail);
    } catch (err) {
      return handleError(err, reply);
    }
  });
}

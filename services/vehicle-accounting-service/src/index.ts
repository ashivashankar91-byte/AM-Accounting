import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/vehicle-accounting-client';
import {
  AuthzClient, HttpAuthzClient,
  HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import pino from 'pino';

import { unitRoutes } from './http/unit-routes';
import { demoRoutes } from './http/demo-routes';
import { lcnrvRoutes } from './http/lcnrv-routes';
import { dealerTradeRoutes } from './http/dealer-trade-routes';
import { configRoutes } from './http/config-routes';

import { VehicleUnitService } from './application/vehicle-unit-service';
import { DemoService } from './application/demo-service';
import { LcnrvService } from './application/lcnrv-service';
import { DealerTradeService } from './application/dealer-trade-service';
import { VehicleAccountingConfigService } from './application/config-service';
import { PostingOrchestrator } from './application/posting-orchestrator';

import { HttpPostingEngineClient } from './infrastructure/posting-engine-client';
import { HttpPostingRecoveryClient } from './infrastructure/posting-recovery-client';
import { ScheduleServiceClient } from './infrastructure/schedule-client';

const logger = pino({ name: 'vehicle-accounting-service' });

async function bootstrap() {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting vehicle-accounting-service.');
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  // Sets app.current_tenant_id on every query, enforced by RLS policies
  // (migration 20260802010001_add_rls_policies_vehicle_accounting_svc).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  container.registerInstance('PrismaClient', prisma);

  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err, req) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  // CE-12 canonical posting path: this service posts EVERY financial event
  // through coa-service's rule-pack-governed posting engine — never
  // gl-service, never a raw journal write (GLOBAL RULES).
  container.registerInstance('PostingEngineClient', new HttpPostingEngineClient(JWT_SECRET));
  container.registerInstance('PostingRecoveryClient', new HttpPostingRecoveryClient(JWT_SECRET));
  container.registerInstance(ScheduleServiceClient, new ScheduleServiceClient());
  container.register(PostingOrchestrator, { useClass: PostingOrchestrator });

  container.register(VehicleUnitService, { useClass: VehicleUnitService });
  container.register(DemoService, { useClass: DemoService });
  container.register(LcnrvService, { useClass: LcnrvService });
  container.register(DealerTradeService, { useClass: DealerTradeService });
  container.register(VehicleAccountingConfigService, { useClass: VehicleAccountingConfigService });

  const prefix = '/api/v1/vehicle-accounting';
  await app.register(unitRoutes, { prefix });
  await app.register(demoRoutes, { prefix });
  await app.register(lcnrvRoutes, { prefix });
  await app.register(dealerTradeRoutes, { prefix });
  await app.register(configRoutes, { prefix });

  app.get('/health', async () => ({ status: 'ok', service: 'vehicle-accounting-service' }));

  // Drain audit_outbox to the real S007 audit-service — same pattern as
  // coa-service's src/index.ts (AuditOutboxDrainer + HttpAuditClient +
  // makePrismaAuditOutboxStore).
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'vehicle-accounting-service',
      onFailed: (row, err, willRetry) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3090', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`vehicle-accounting-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start vehicle-accounting-service');
  process.exit(1);
});

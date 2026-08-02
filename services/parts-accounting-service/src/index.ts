import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { partsAccountingRoutes } from './http/routes';
import { ValuationConfigService } from './application/valuation-config-service';
import { MovementService } from './application/movement-service';
import { PriceTapeService } from './application/price-tape-service';
import { ObsolescenceService } from './application/obsolescence-service';
import { PhysicalInventoryService } from './application/physical-inventory-service';
import { DepositService } from './application/deposit-service';
import { OemReturnService } from './application/oem-return-service';
import { PartsAccountMappingService } from './application/account-mapping-service';
import { HttpPostingEventProducer, PostingEventProducer } from './infrastructure/posting-client';
import { HttpGlBalanceClient, GlBalanceClient } from './infrastructure/gl-balance-client';
import {
  AuthzClient, HttpAuthzClient, HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/parts-accounting-client';
import pino from 'pino';

const logger = pino({ name: 'parts-accounting-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  // Sets app.current_tenant_id on every query, enforced by RLS policies
  // (see prisma/migrations/*_add_rls_policies_parts_accounting_svc). Legal-
  // entity scoping is enforced at the application layer, same as tax-service.
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  app.decorate('prisma', prisma);

  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required.');

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<PostingEventProducer>('PostingEventProducer', new HttpPostingEventProducer(JWT_SECRET));
  container.registerInstance<GlBalanceClient>('GlBalanceClient', new HttpGlBalanceClient(JWT_SECRET));
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  container.register(ValuationConfigService, { useClass: ValuationConfigService });
  container.register(MovementService, { useClass: MovementService });
  container.register(PriceTapeService, { useClass: PriceTapeService });
  container.register(ObsolescenceService, { useClass: ObsolescenceService });
  container.register(PhysicalInventoryService, { useClass: PhysicalInventoryService });
  container.register(DepositService, { useClass: DepositService });
  container.register(OemReturnService, { useClass: OemReturnService });
  container.register(PartsAccountMappingService, { useClass: PartsAccountMappingService });

  await app.register(partsAccountingRoutes, { prefix: '/api/v1/parts-accounting' });
  app.get('/health', async () => ({ status: 'ok', service: 'parts-accounting-service' }));

  // Drain audit_outbox_event to the real S007 audit-service — same pattern
  // as every other service's audit outbox drainer.
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'parts-accounting-service',
      onFailed: (row: any, err: any, willRetry: any) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3061', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`parts-accounting-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start parts-accounting-service');
  process.exit(1);
});

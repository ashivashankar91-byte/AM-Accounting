import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { oemRoutes } from './http/routes';
import { OemProfileService } from './application/profile-service';
import { OemStagingService } from './application/staging-service';
import { OemMatchService } from './application/match-service';
import { OemIncentiveService } from './application/incentive-service';
import { OemStatementService } from './application/statement-service';
import { OemWarrantyService } from './application/warranty-service';
import { OemCoopService } from './application/coop-service';
import { OemAdapterRegistry } from './domain/adapter-spi';
import { FordAdapter } from './domain/adapters/ford-adapter';
import { GmAdapter } from './domain/adapters/gm-adapter';
import { UnwiredOpenItemSource } from './domain/upstream-items';
import { UnwiredDealFinalizedSource } from './domain/upstream-deal-events';
import { UnwiredApDocumentSource } from './domain/upstream-ap-docs';
import { FixtureOpenItemSource, FixtureDealFinalizedSource, FixtureApDocumentSource } from './infrastructure/fixture-sources';
import { GlTrialBalanceClient } from './infrastructure/gl-client';
import {
  AuthzClient, HttpAuthzClient, HttpAuditClient, AuditOutboxDrainer, makePrismaAuditOutboxStore,
  createTenantRlsMiddleware, tenantContextHook,
} from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/oem-client';
import pino from 'pino';

const logger = pino({ name: 'oem-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info('Prisma connected');

  // CE-14: set app.current_tenant_id on every query, enforced by RLS
  // policies (migration 20260801201015_add_rls_policies_oem_svc).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));

  // S098 adapter framework: register the two Pass-1 make adapters (S099
  // Ford, S100 GM). Additional Pass-2 makes register here under S102.
  const adapterRegistry = new OemAdapterRegistry();
  adapterRegistry.register(new FordAdapter());
  adapterRegistry.register(new GmAdapter());
  container.registerInstance('OemAdapterRegistry', adapterRegistry);

  // PENDING_UPSTREAM_TECHNICAL_RECONCILIATION boundaries (CE-11 S065/S071,
  // CE-12 deal.finalized, CE-09 AP docs — none implemented in this
  // worktree). Truthful-by-default: only OEM_USE_FIXTURE_UPSTREAM=true
  // (certification/dev use, never a real deployment default) swaps in the
  // deterministic fixture sources so S101A/S103A/S105/S106's real logic can
  // be exercised end-to-end without claiming those epics exist here.
  const useFixtures = process.env['OEM_USE_FIXTURE_UPSTREAM'] === 'true';
  container.registerInstance('OpenItemSource', useFixtures ? new FixtureOpenItemSource() : new UnwiredOpenItemSource());
  container.registerInstance('DealFinalizedSource', useFixtures ? new FixtureDealFinalizedSource() : new UnwiredDealFinalizedSource());
  container.registerInstance('ApDocumentSource', useFixtures ? new FixtureApDocumentSource() : new UnwiredApDocumentSource());
  logger.info({ useFixtures }, 'upstream PUTR sources wired');

  container.registerInstance('GlTrialBalanceClient', new GlTrialBalanceClient());

  container.register(OemProfileService, { useClass: OemProfileService });
  container.register(OemStagingService, { useClass: OemStagingService });
  container.register(OemMatchService, { useClass: OemMatchService });
  container.register(OemIncentiveService, { useClass: OemIncentiveService });
  container.register(OemStatementService, { useClass: OemStatementService });
  container.register(OemWarrantyService, { useClass: OemWarrantyService });
  container.register(OemCoopService, { useClass: OemCoopService });

  await app.register(oemRoutes, { prefix: '/api/v1/oem' });
  app.get('/health', async () => ({ status: 'ok', service: 'oem-service' }));

  // CE-14: drain audit_outbox to the real S007 audit-service, same pattern
  // as every other service.
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'oem-service',
      onFailed: (row: any, err: unknown, willRetry: boolean) =>
        logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const shutdown = async () => {
    logger.info('Shutting down oem-service...');
    stopAuditDrainer();
    await prisma.$disconnect();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const port = parseInt(process.env['PORT'] ?? '3052', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`oem-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error({ err }, 'oem-service failed to start');
  process.exit(1);
});

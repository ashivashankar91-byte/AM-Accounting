import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/floorplan-client';
import { floorplanRoutes } from './http/routes';
import { HttpPostingEngineClient } from './infrastructure/posting-engine-client';
import { HttpPostingRecoveryClient } from './infrastructure/posting-recovery-client';
import { HttpScheduleServiceClient } from './infrastructure/schedule-service-client';
import { makeFloorplanAuditStore } from './infrastructure/audit';
import { POSTING_ENGINE_CLIENT_TOKEN, POSTING_RECOVERY_CLIENT_TOKEN, PostingOrchestrator } from './application/posting-orchestrator';
import { LenderService } from './application/lender-service';
import { FeedService } from './application/feed-service';
import { MatchService } from './application/match-service';
import { BreakService } from './application/break-service';
import { TieOutService, SCHEDULE_SERVICE_CLIENT_TOKEN } from './application/tie-out-service';
import { SotService } from './application/sot-service';
import { InterestService } from './application/interest-service';
import { CurtailmentService } from './application/curtailment-service';
import { TenantConfigService } from './application/tenant-config-service';
import {
  AuthzClient,
  HttpAuthzClient,
  HttpAuditClient,
  AuditOutboxDrainer,
  createTenantRlsMiddleware,
  tenantContextHook,
} from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'floorplan-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info('Prisma connected');

  // Sets app.current_tenant_id on every query, enforced by RLS policies
  // (migration 20260802010001_add_rls_policies_floorplan_svc).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance(POSTING_ENGINE_CLIENT_TOKEN, new HttpPostingEngineClient());
  container.registerInstance(POSTING_RECOVERY_CLIENT_TOKEN, new HttpPostingRecoveryClient());
  container.registerInstance(SCHEDULE_SERVICE_CLIENT_TOKEN, new HttpScheduleServiceClient());
  container.register(PostingOrchestrator, { useClass: PostingOrchestrator });
  container.register(LenderService, { useClass: LenderService });
  container.register(FeedService, { useClass: FeedService });
  container.register(MatchService, { useClass: MatchService });
  container.register(BreakService, { useClass: BreakService });
  container.register(TieOutService, { useClass: TieOutService });
  container.register(SotService, { useClass: SotService });
  container.register(InterestService, { useClass: InterestService });
  container.register(CurtailmentService, { useClass: CurtailmentService });
  container.register(TenantConfigService, { useClass: TenantConfigService });
  container.registerInstance<AuthzClient>(
    'AuthzClient',
    new HttpAuthzClient({
      onError: (err: unknown, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
    }),
  );

  await app.register(floorplanRoutes, { prefix: '/api/v1/floorplan' });
  app.get('/health', async () => ({ status: 'ok', service: 'floorplan-service' }));

  // Drain floorplan_audit_reference to the real S007 audit-service — same
  // pattern as every other service's audit outbox drainer.
  const auditDrainer = new AuditOutboxDrainer(
    makeFloorplanAuditStore((prisma as any).floorplanAuditReference),
    new HttpAuditClient(),
    {
      serviceName: 'floorplan-service',
      onFailed: (row: any, err: unknown, willRetry: boolean) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3091', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await app.listen({ port, host });
  logger.info(`floorplan-service listening on ${host}:${port}`);

  const shutdown = async () => {
    logger.info('Shutting down floorplan-service...');
    stopAuditDrainer();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start floorplan-service:', err);
  process.exit(1);
});

import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/fni-reserve-client';
import { fniReserveRoutes } from './http/routes';
import {
  AuthzClient,
  HttpAuthzClient,
  HttpAuditClient,
  AuditOutboxDrainer,
  makePrismaAuditOutboxStore,
  createTenantRlsMiddleware,
  tenantContextHook,
} from '@amacc/shared-kernel';
import { HttpPostingClient } from './infrastructure/posting-client';
import { HttpPostingRecoveryClient } from './infrastructure/posting-recovery-client';
import { HttpScheduleOpenItemClient } from './infrastructure/schedule-open-item-client';
import { PostingOrchestrator, POSTING_CLIENT_TOKEN, POSTING_RECOVERY_CLIENT_TOKEN } from './application/posting-orchestrator';
import { ConfigService } from './application/config-service';
import { ReserveService } from './application/reserve-service';
import { RemitService, SCHEDULE_OPEN_ITEM_CLIENT_TOKEN } from './application/remit-service';
import { CancellationService } from './application/cancellation-service';
import { DeferralService } from './application/deferral-service';
import { ChargebackDrawExecutor } from './application/chargeback-draw-executor';
import pino from 'pino';

const logger = pino({ name: 'fni-reserve-service' });

async function bootstrap() {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting fni-reserve-service.');
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info('Prisma connected');

  // Sets app.current_tenant_id on every query, enforced by RLS policies
  // (migration 20260802020000_add_rls_policies_fni_reserve_svc).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  // ── DI registrations ───────────────────────────────────────────────────
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<AuthzClient>(
    'AuthzClient',
    new HttpAuthzClient({
      onError: (err: unknown, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
    }),
  );
  container.registerInstance(POSTING_CLIENT_TOKEN, new HttpPostingClient(JWT_SECRET));
  container.registerInstance(POSTING_RECOVERY_CLIENT_TOKEN, new HttpPostingRecoveryClient(JWT_SECRET));
  container.registerInstance(SCHEDULE_OPEN_ITEM_CLIENT_TOKEN, new HttpScheduleOpenItemClient(JWT_SECRET));

  container.register(PostingOrchestrator, { useClass: PostingOrchestrator });
  container.register(ConfigService, { useClass: ConfigService });
  container.register(ChargebackDrawExecutor, { useClass: ChargebackDrawExecutor });
  container.register(ReserveService, { useClass: ReserveService });
  container.register(RemitService, { useClass: RemitService });
  container.register(CancellationService, { useClass: CancellationService });
  container.register(DeferralService, { useClass: DeferralService });

  await app.register(fniReserveRoutes);

  app.get('/health', async () => ({ status: 'ok', service: 'fni-reserve-service' }));

  const port = parseInt(process.env['PORT'] ?? '3093', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';
  await app.listen({ port, host });
  logger.info(`fni-reserve-service listening on ${host}:${port}`);

  // Drain audit_outbox to the real S007 audit-service — same pattern as
  // every other CE-12/CE-08/CE-10 service (posting-recovery-service,
  // schedule-service, coa-service, tax-service, ...).
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'fni-reserve-service',
      onFailed: (row: any, err: unknown, willRetry: boolean) =>
        logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  auditDrainer.start(5000);

  const shutdown = async () => {
    logger.info('fni-reserve-service shutting down');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error({ err }, 'fni-reserve-service failed to start');
  process.exit(1);
});

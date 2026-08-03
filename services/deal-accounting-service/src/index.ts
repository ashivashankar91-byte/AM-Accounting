import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import {
  AuthzClient, HttpAuthzClient, HttpAuditClient, AuditOutboxDrainer,
  createTenantRlsMiddleware, tenantContextHook, IEventPublisher,
} from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/deal-accounting-client';
import pino from 'pino';

import { dealAccountingRoutes } from './http/routes';
import { dealPeriodReadinessRoutes } from './http/period-readiness-routes';
import { makeDealAuditStore } from './infrastructure/audit';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { DomainOutboxDrainer } from './infrastructure/putr-outbox';
import { HttpPostingEngineClient, IPostingEngineClient } from './infrastructure/posting-engine-client';
import { HttpPostingRecoveryClient, IPostingRecoveryClient } from './infrastructure/posting-recovery-client';
import { HttpTaxResultClient, ITaxResultClient } from './infrastructure/tax-result-client';
import { HttpJournalReversalClient, IJournalReversalClient } from './infrastructure/journal-reversal-client';
import { HttpScheduleServiceClient, IScheduleServiceClient } from './infrastructure/schedule-service-client';
import { DealPostingOrchestrator } from './application/deal-posting-orchestrator';
import { DealFinalizeService } from './application/deal-finalize-service';
import { BillerReviewService } from './application/biller-review-service';
import { UnwindService } from './application/unwind-service';
import { RecontractService } from './application/recontract-service';
import { CitFundingService } from './application/cit-funding-service';
import { PayoffService } from './application/payoff-service';
import { WholesaleService } from './application/wholesale-service';
import { DueBillService } from './application/due-bill-service';

const logger = pino({ name: 'deal-accounting-service' });

async function bootstrap() {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) {
    throw new Error('FATAL: AMACC_JWT_SECRET environment variable is not set. Set it before starting deal-accounting-service.');
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  // Sets app.current_tenant_id on every query, enforced by RLS policies
  // (migration 20260802010001_add_rls_policies_deal_accounting_svc).
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  app.decorate('prisma', prisma);

  // ── DI registrations ─────────────────────────────────────────────────────
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<AuthzClient>('AuthzClient', new HttpAuthzClient({
    onError: (err: any, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
  }));
  container.registerInstance<IPostingEngineClient>('IPostingEngineClient', new HttpPostingEngineClient(JWT_SECRET));
  container.registerInstance<IPostingRecoveryClient>('IPostingRecoveryClient', new HttpPostingRecoveryClient(JWT_SECRET));
  container.registerInstance<ITaxResultClient>('ITaxResultClient', new HttpTaxResultClient(JWT_SECRET));
  container.registerInstance<IJournalReversalClient>('IJournalReversalClient', new HttpJournalReversalClient(JWT_SECRET));
  container.registerInstance<IScheduleServiceClient>('IScheduleServiceClient', new HttpScheduleServiceClient(JWT_SECRET));

  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  container.register(DealPostingOrchestrator, { useClass: DealPostingOrchestrator });
  container.register(DealFinalizeService, { useClass: DealFinalizeService });
  container.register(BillerReviewService, { useClass: BillerReviewService });
  container.register(UnwindService, { useClass: UnwindService });
  container.register(RecontractService, { useClass: RecontractService });
  container.register(CitFundingService, { useClass: CitFundingService });
  container.register(PayoffService, { useClass: PayoffService });
  container.register(WholesaleService, { useClass: WholesaleService });
  container.register(DueBillService, { useClass: DueBillService });

  await app.register(dealAccountingRoutes, { prefix: '/api/v1/deal-accounting' });
  await app.register(dealPeriodReadinessRoutes, { prefix: '/api/v1/deal-accounting' });
  app.get('/health', async () => ({ status: 'ok', service: 'deal-accounting-service' }));

  // Drain deal_audit_reference to the real S007 audit-service — same
  // pattern as every other service's audit outbox drainer.
  const auditDrainer = new AuditOutboxDrainer(
    makeDealAuditStore((prisma as any).dealAuditReference),
    new HttpAuditClient(),
    { serviceName: 'deal-accounting-service', onFailed: (row: any, err: any, willRetry: any) => logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed') },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  // Drain deal_outbox_event (PUTR events for sibling CE-12 services) to the broker.
  const domainOutboxDrainer = new DomainOutboxDrainer(prisma, eventPublisher);
  const stopDomainOutboxDrainer = domainOutboxDrainer.start(5000);

  const port = parseInt(process.env['PORT'] ?? '3092', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`deal-accounting-service listening on :${port}`);

  const shutdown = () => { stopAuditDrainer(); stopDomainOutboxDrainer(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start deal-accounting-service');
  process.exit(1);
});

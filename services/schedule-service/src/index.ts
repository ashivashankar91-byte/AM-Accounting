import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/schedule-client';
import { scheduleRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaScheduleRepository } from './infrastructure/schedule-repository';
import { PrismaScheduleDetailRepository } from './infrastructure/schedule-detail-repository';
import { PrismaSchedulePermissionRepository } from './infrastructure/schedule-permission-repository';
import { PrismaScheduleOpenItemRepository } from './infrastructure/schedule-open-item-repository';
import { PrismaScheduleTieOutRepository } from './infrastructure/schedule-tie-out-repository';
import { PrismaScheduleAgingConfigRepository } from './infrastructure/schedule-aging-config-repository';
import { HttpGlBalanceClient } from './infrastructure/gl-balance-client';
import {
  ScheduleApplicationService,
  SCHEDULE_REPO_TOKEN,
  SCHEDULE_DETAIL_REPO_TOKEN,
  SCHEDULE_PERMISSION_REPO_TOKEN,
  EVENT_PUBLISHER_TOKEN,
} from './application/schedule-service';
import { OpenItemService, SCHEDULE_OPEN_ITEM_REPO_TOKEN } from './application/open-item-service';
import { TieOutService, SCHEDULE_TIE_OUT_REPO_TOKEN, GL_BALANCE_CLIENT_TOKEN } from './application/tie-out-service';
import { AgingService, SCHEDULE_AGING_CONFIG_REPO_TOKEN } from './application/aging-service';
import { ScheduleEventHandlers } from './application/event-handlers';
import type { IEventPublisher, AuthzClient } from '@amacc/shared-kernel';
import {
  OutboxProcessor,
  createTenantRlsMiddleware,
  tenantContextHook,
  HttpAuthzClient,
  HttpAuditClient,
  AuditOutboxDrainer,
  makePrismaAuditOutboxStore,
} from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'schedule-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info('Prisma connected');

  // S026: set app.current_tenant_id on every query, enforced by RLS policies
  // on schedules/schedule_details/schedule_permissions/schedule_open_items/
  // schedule_applications/schedule_gl_tie_outs (migration
  // 20260730010001_add_rls_policies_schedule_svc). schedule-service had no
  // RLS at all before this.
  (prisma as any).$use(createTenantRlsMiddleware(prisma));
  app.addHook('preHandler', tenantContextHook);

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();
  logger.info('RabbitMQ connected');

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>(EVENT_PUBLISHER_TOKEN, eventPublisher);
  container.register(SCHEDULE_REPO_TOKEN, { useClass: PrismaScheduleRepository });
  container.register(SCHEDULE_DETAIL_REPO_TOKEN, { useClass: PrismaScheduleDetailRepository });
  container.register(SCHEDULE_PERMISSION_REPO_TOKEN, { useClass: PrismaSchedulePermissionRepository });
  container.register(SCHEDULE_OPEN_ITEM_REPO_TOKEN, { useClass: PrismaScheduleOpenItemRepository });
  container.register(SCHEDULE_TIE_OUT_REPO_TOKEN, { useClass: PrismaScheduleTieOutRepository });
  container.register(SCHEDULE_AGING_CONFIG_REPO_TOKEN, { useClass: PrismaScheduleAgingConfigRepository });
  container.registerInstance(GL_BALANCE_CLIENT_TOKEN, new HttpGlBalanceClient());
  container.register(ScheduleApplicationService, { useClass: ScheduleApplicationService });
  container.register(OpenItemService, { useClass: OpenItemService });
  container.register(TieOutService, { useClass: TieOutService });
  container.register(AgingService, { useClass: AgingService });
  container.registerInstance<AuthzClient>(
    'AuthzClient',
    new HttpAuthzClient({
      onError: (err: unknown, req: any) => logger.error({ err, permission: req.permissionKey }, 'authz/check failed'),
    }),
  );

  // Wire inbound events
  const eventHandlers = container.resolve(ScheduleEventHandlers);
  eventPublisher.subscribe('JOURNAL_ENTRY_POSTED', async (event) => {
    if ((event.payload as any)?.entryId !== undefined && (event.payload as any)?.scheduleNumber === undefined) {
      // The "whole entry posted" notification (no scheduleNumber/controlNumber)
      // gl-service also publishes for every journal under the same eventType —
      // not schedule-relevant, ignore it here.
      return;
    }
    await eventHandlers.handleJournalEntryPosted(event.payload as any, event.correlationId);
  });

  await app.register(scheduleRoutes);

  app.get('/health', async () => ({ status: 'ok', service: 'schedule-service' }));

  const port = parseInt(process.env['PORT'] ?? '3018', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';

  await app.listen({ port, host });
  logger.info(`schedule-service listening on ${host}:${port}`);

  const outboxProcessor = new OutboxProcessor(
    eventPublisher,
    async () => {
      const records = await prisma.outboxEvent.findMany({
        where: { publishedAt: null, retryCount: { lt: 10 } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      return records.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        tenantId: r.tenantId,
        payload: r.payload as Record<string, unknown>,
        correlationId: r.correlationId,
        publishedAt: r.publishedAt,
        retryCount: r.retryCount,
        lastError: r.lastError,
      }));
    },
    async (id: string) => {
      await prisma.outboxEvent.update({ where: { id }, data: { publishedAt: new Date() } });
    },
    async (id: string, error?: string) => {
      await prisma.outboxEvent.update({
        where: { id },
        data: { retryCount: { increment: 1 }, lastError: error ?? null },
      });
    },
  );
  outboxProcessor.startPolling(5000);

  // S026: schedule-service had no audit mechanism at all before this — drain
  // audit_outbox to the real S007 audit-service (same pattern as
  // tenant-service/auth-service/coa-service/apar-service).
  const auditDrainer = new AuditOutboxDrainer(
    makePrismaAuditOutboxStore((prisma as any).auditOutboxEvent),
    new HttpAuditClient(),
    {
      serviceName: 'schedule-service',
      onFailed: (row: any, err: unknown, willRetry: boolean) =>
        logger.error({ outboxId: row.id, err, willRetry }, 'audit outbox delivery failed'),
    },
  );
  const stopAuditDrainer = auditDrainer.start(5000);

  // S026: nightly GL-to-schedule tie-out. Runs once per tenant per calendar
  // day; also callable on demand via POST /api/v1/schedules/tie-outs/run
  // (used by Playwright/ops without waiting a day). "Nightly" is
  // approximated here as a 24h in-process poll — the same pattern the rest
  // of this repo uses for background work (OutboxProcessor, AuditOutboxDrainer)
  // rather than introducing a new scheduler dependency for one job.
  const tieOutService = container.resolve(TieOutService);
  const TIE_OUT_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const runNightlyTieOut = async () => {
    try {
      const tenants = await (prisma as any).schedule.findMany({
        distinct: ['tenantId'],
        select: { tenantId: true },
      });
      for (const { tenantId } of tenants) {
        const { runId, rows } = await tieOutService.runTieOut(tenantId, new Date(), 'system:nightly-tie-out');
        const discrepancies = rows.filter((r: any) => r.status === 'DISCREPANCY').length;
        logger.info({ tenantId, runId, rows: rows.length, discrepancies }, 'nightly tie-out completed');
      }
    } catch (err) {
      logger.error({ err }, 'nightly tie-out run failed');
    }
  };
  const tieOutTimer = setInterval(runNightlyTieOut, TIE_OUT_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down schedule-service...');
    outboxProcessor.stop();
    stopAuditDrainer();
    clearInterval(tieOutTimer);
    await app.close();
    await prisma.$disconnect();
    await eventPublisher.disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start schedule-service:', err);
  process.exit(1);
});

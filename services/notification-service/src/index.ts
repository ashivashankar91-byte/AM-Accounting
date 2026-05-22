import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { WebhookChannel, ConsoleChannel } from './domain/channels';
import { INotificationChannel, TenantId } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'notification-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  // Notification channels — add new ones without changing existing code (Open/Closed)
  const channels: INotificationChannel[] = [
    new WebhookChannel(),
    new ConsoleChannel(),
  ];

  async function notify(tenantId: string, message: string, metadata: Record<string, unknown>) {
    await Promise.allSettled(
      channels.map((ch) => ch.send(tenantId as TenantId, message, metadata)),
    );
  }

  eventPublisher.subscribe('AGENT_HUMAN_REQUIRED', async (event) => {
    await notify(event.tenantId, `Agent requires human intervention: ${event.payload['agentName']}`, event.payload);
  });

  eventPublisher.subscribe('PAYROLL_BATCH_HELD', async (event) => {
    await notify(event.tenantId, `Payroll batch held: ${event.payload['reason']}`, event.payload);
  });

  eventPublisher.subscribe('EOM_CLOSE_BLOCKED', async (event) => {
    await notify(event.tenantId, `EOM close blocked`, event.payload);
  });

  // Wave 1-4 events
  eventPublisher.subscribe('EOM_CLOSE_COMPLETED', async (event) => {
    const { periodYear, periodMonth, closeType } = event.payload as any;
    await notify(event.tenantId, `EOM close completed: ${periodYear}-${String(periodMonth).padStart(2,'0')} (${closeType})`, event.payload);
  });

  eventPublisher.subscribe('YEAR_END_COMPLETED', async (event) => {
    const { fiscalYear } = event.payload as any;
    await notify(event.tenantId, `Year-end close completed for fiscal year ${fiscalYear}`, event.payload);
  });

  eventPublisher.subscribe('THIRTEENTH_MONTH_FINALIZED', async (event) => {
    const { year } = event.payload as any;
    await notify(event.tenantId, `13th month finalized for ${year}`, event.payload);
  });

  eventPublisher.subscribe('GL_INTEGRITY_ALERT', async (event) => {
    const { alertType, entryId } = event.payload as any;
    await notify(event.tenantId, `GL integrity alert [${alertType}] on entry ${entryId}`, event.payload);
  });

  eventPublisher.subscribe('COMPLIANCE_ALERT', async (event) => {
    const { ruleId, alertType } = event.payload as any;
    await notify(event.tenantId, `Compliance alert [${alertType}] triggered by rule ${ruleId}`, event.payload);
  });

  eventPublisher.subscribe('JOURNAL_ENTRY_POSTED', async (event) => {
    // Only notify on high-value postings (> $100,000 total debits)
    const { totalDebits, entryId } = event.payload as any;
    if (Number(totalDebits) > 100000) {
      await notify(event.tenantId, `Large journal entry posted: ${entryId} ($${totalDebits} total debits)`, event.payload);
    }
  });

  eventPublisher.subscribe('SCHEDULE_PURGED', async (event) => {
    const { schedulesPurged, closeDate } = event.payload as any;
    await notify(event.tenantId, `EOM purge complete: ${schedulesPurged} schedules purged for close date ${closeDate}`, event.payload);
  });

  app.get('/health', async () => ({ status: 'ok', service: 'notification-service' }));
  const port = parseInt(process.env['PORT'] ?? '3030', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`notification-service listening on :${port}`);
}

bootstrap().catch((err) => { logger.error(err); process.exit(1); });

import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/webhook-client';
import { WebhookService } from './application/webhook-service';
import { webhookRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { DomainEvent } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'webhook-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const webhookService = new WebhookService(prisma);

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();

  // Subscribe to ALL events and dispatch to registered webhooks
  const allEventTypes = [
    'JOURNAL_ENTRY_SUBMITTED', 'JOURNAL_ENTRY_POSTED', 'JOURNAL_ENTRY_HELD', 'GL_ANOMALY_DETECTED',
    'EOM_CLOSE_INITIATED', 'EOM_STEP_CHANGED', 'EOM_CLOSE_BLOCKED', 'EOM_CLOSE_COMPLETED', 'TRIAL_BALANCE_READY',
    'FS_PREVIEW_READY', 'FS_LINE_ANOMALY_DETECTED', 'FS_SUBMITTED', 'FS_ACCEPTED_BY_OEM', 'FS_REJECTED_BY_OEM',
    'COA_MAPPING_GAP_DETECTED', 'COA_VERSION_UPDATED',
    'PAYROLL_BATCH_SUBMITTED', 'PAYROLL_BATCH_HELD', 'PAYROLL_BATCH_POSTED',
    'OEM_REMITTANCE_IMPORTED', 'BANK_RECON_STARTED', 'BANK_RECON_COMPLETED',
    'AGENT_HUMAN_REQUIRED', 'AGENT_ACTION_TAKEN', 'AGENT_ACTION_APPROVED', 'AGENT_ACTION_REJECTED',
    'APPROVAL_REQUESTED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'APPROVAL_EXPIRED',
    'TENANT_PROVISIONED', 'TENANT_UPDATED', 'DMS_SYNC_COMPLETED', 'LEGACY_GL_MAPPED', 'ONBOARDING_COMPLETED',
    'SERVICE_RO_CLOSED', 'PARTS_INVOICE_CLOSED', 'DEAL_PRODUCT_DETAIL_RECEIVED',
    'VEHICLE_PURCHASED', 'VEHICLE_TRANSFERRED', 'PAYROLL_LINES_SUBMITTED',
    'FINANCE_CHARGE_POSTED', 'CREDIT_CARD_BATCH_SETTLED', 'CASH_RECEIPT_DETAILED',
    'YEAR_END_CLOSE_POSTED', 'AMDB_DROPMATE_IMPORTED', 'TECH_HOURS_RECONCILED', 'DEPARTMENT_PL_READY',
  ];

  for (const eventType of allEventTypes) {
    eventPublisher.subscribe(eventType, async (event: DomainEvent) => {
      try {
        await webhookService.dispatchEvent(
          event.tenantId,
          event.type,
          event.payload,
        );
      } catch (err) {
        logger.error({ eventType, err: (err as Error).message }, 'Webhook dispatch failed');
      }
    });
  }

  await app.register(webhookRoutes(webhookService), { prefix: '/api/v1/webhooks' });
  app.get('/health', async () => ({ status: 'ok', service: 'webhook-service' }));

  const port = parseInt(process.env['PORT'] ?? '3036', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`webhook-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start webhook-service');
  process.exit(1);
});

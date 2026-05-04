import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/audit-client';
import { AuditService } from './application/audit-service';
import { auditRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { DomainEvent } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'audit-service' });

// Map event types to entity types and actions
function eventToAuditFields(event: DomainEvent): { entityType: string; entityId: string; action: string } {
  const p = event.payload;
  switch (event.type) {
    case 'JOURNAL_ENTRY_SUBMITTED':
      return { entityType: 'JournalEntry', entityId: (p['entryId'] as string) ?? '', action: 'SUBMITTED' };
    case 'JOURNAL_ENTRY_POSTED':
      return { entityType: 'JournalEntry', entityId: (p['entryId'] as string) ?? '', action: 'POSTED' };
    case 'JOURNAL_ENTRY_HELD':
      return { entityType: 'JournalEntry', entityId: (p['entryId'] as string) ?? '', action: 'HELD' };
    case 'GL_ANOMALY_DETECTED':
      return { entityType: 'GLAnomaly', entityId: (p['entryId'] as string) ?? event.correlationId, action: 'DETECTED' };
    case 'EOM_CLOSE_INITIATED':
      return { entityType: 'EOMClose', entityId: (p['closeId'] as string) ?? '', action: 'INITIATED' };
    case 'EOM_STEP_CHANGED':
      return { entityType: 'EOMStep', entityId: (p['stepCode'] as string) ?? '', action: 'CHANGED' };
    case 'EOM_CLOSE_BLOCKED':
      return { entityType: 'EOMClose', entityId: (p['closeId'] as string) ?? '', action: 'BLOCKED' };
    case 'EOM_CLOSE_COMPLETED':
      return { entityType: 'EOMClose', entityId: (p['closeId'] as string) ?? '', action: 'COMPLETED' };
    case 'PAYROLL_BATCH_SUBMITTED':
      return { entityType: 'PayrollBatch', entityId: (p['batchId'] as string) ?? '', action: 'SUBMITTED' };
    case 'PAYROLL_BATCH_HELD':
      return { entityType: 'PayrollBatch', entityId: (p['batchId'] as string) ?? '', action: 'HELD' };
    case 'PAYROLL_BATCH_POSTED':
      return { entityType: 'PayrollBatch', entityId: (p['batchId'] as string) ?? '', action: 'POSTED' };
    case 'AGENT_HUMAN_REQUIRED':
      return { entityType: 'AgentAction', entityId: (p['actionId'] as string) ?? '', action: 'HUMAN_REQUIRED' };
    case 'AGENT_ACTION_TAKEN':
      return { entityType: 'AgentAction', entityId: (p['actionId'] as string) ?? '', action: 'ACTION_TAKEN' };
    case 'APPROVAL_REQUESTED':
      return { entityType: 'Approval', entityId: (p['requestId'] as string) ?? '', action: 'REQUESTED' };
    case 'APPROVAL_GRANTED':
      return { entityType: 'Approval', entityId: (p['requestId'] as string) ?? '', action: 'GRANTED' };
    case 'APPROVAL_REJECTED':
      return { entityType: 'Approval', entityId: (p['requestId'] as string) ?? '', action: 'REJECTED' };
    case 'SERVICE_RO_CLOSED':
      return { entityType: 'ServiceRO', entityId: (p['roNumber'] as string) ?? '', action: 'CLOSED' };
    case 'PARTS_INVOICE_CLOSED':
      return { entityType: 'PartsInvoice', entityId: (p['invoiceNumber'] as string) ?? '', action: 'CLOSED' };
    case 'DEAL_PRODUCT_DETAIL_RECEIVED':
      return { entityType: 'DealProduct', entityId: (p['dealNumber'] as string) ?? '', action: 'RECEIVED' };
    case 'VEHICLE_PURCHASED':
      return { entityType: 'Vehicle', entityId: (p['vin'] as string) ?? '', action: 'PURCHASED' };
    case 'VEHICLE_TRANSFERRED':
      return { entityType: 'Vehicle', entityId: (p['vin'] as string) ?? '', action: 'TRANSFERRED' };
    case 'PAYROLL_LINES_SUBMITTED':
      return { entityType: 'PayrollBatch', entityId: (p['batchRef'] as string) ?? '', action: 'LINES_SUBMITTED' };
    default:
      return { entityType: event.type, entityId: event.correlationId, action: event.type };
  }
}

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const auditService = new AuditService(prisma);

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();

  // Subscribe to ALL events and log them
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
    // New events
    'SERVICE_RO_CLOSED', 'PARTS_INVOICE_CLOSED', 'DEAL_PRODUCT_DETAIL_RECEIVED',
    'VEHICLE_PURCHASED', 'VEHICLE_TRANSFERRED', 'PAYROLL_LINES_SUBMITTED',
    'FINANCE_CHARGE_POSTED', 'CREDIT_CARD_BATCH_SETTLED', 'CASH_RECEIPT_DETAILED',
    'YEAR_END_CLOSE_POSTED', 'AMDB_DROPMATE_IMPORTED', 'TECH_HOURS_RECONCILED', 'DEPARTMENT_PL_READY',
  ];

  for (const eventType of allEventTypes) {
    eventPublisher.subscribe(eventType, async (event: DomainEvent) => {
      const { entityType, entityId, action } = eventToAuditFields(event);
      await auditService.log({
        tenantId: event.tenantId,
        eventType: event.type,
        entityType,
        entityId,
        actorType: (event.payload['actorType'] as string) ?? 'SYSTEM',
        actorId: (event.payload['actorId'] as string) ?? (event.payload['agentName'] as string) ?? 'system',
        actorName: (event.payload['actorName'] as string) ?? (event.payload['agentName'] as string) ?? 'System',
        action,
        newState: event.payload as Record<string, unknown>,
        reason: event.payload['reason'] as string | undefined,
        confidence: event.payload['confidence'] as number | undefined,
        metadata: { correlationId: event.correlationId, occurredAt: event.occurredAt },
      });
    });
  }

  await app.register(auditRoutes(auditService), { prefix: '/api/v1/audit' });
  app.get('/health', async () => ({ status: 'ok', service: 'audit-service' }));

  const port = parseInt(process.env['PORT'] ?? '3031', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`audit-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start audit-service');
  process.exit(1);
});

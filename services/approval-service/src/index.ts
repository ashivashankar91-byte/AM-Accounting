import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { approvalRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import pino from 'pino';

const logger = pino({ name: 'approval-service' });

async function bootstrap() {
  // S031 — Manual JE Approval Governance: approval state MUST be persisted in
  // Postgres. In-memory workflow is never acceptable in production — it loses all
  // pending approvals on restart and cannot be audited (S007). Fail fast if
  // DATABASE_URL is not configured so the problem is immediately visible.
  if (!process.env['DATABASE_URL']) {
    logger.error(
      'DATABASE_URL is required. approval-service must not run in-memory mode. ' +
      'Configure DATABASE_URL to the approval service Postgres connection string.',
    );
    process.exit(1);
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
    serviceName: 'approval-service',
  });
  await eventPublisher.connect();

  const prismaModule = require('.prisma/approval-client');
  const prisma = new prismaModule.PrismaClient();
  const { PrismaApprovalWorkflow } = require('./application/prisma-approval-workflow');
  const workflow: import('@amacc/shared-kernel').IApprovalWorkflow = new PrismaApprovalWorkflow(prisma, eventPublisher);

  await app.register(approvalRoutes(workflow), { prefix: '/api/v1/approvals' });
  app.get('/health', async () => ({ status: 'ok', service: 'approval-service', persistence: 'postgres' }));

  const port = parseInt(process.env['PORT'] ?? '3033', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`approval-service listening on :${port} (Prisma-backed persistence)`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start approval-service');
  process.exit(1);
});

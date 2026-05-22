import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { approvalRoutes } from './http/routes';
import { InMemoryApprovalWorkflow } from './application/approval-workflow';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import pino from 'pino';

const logger = pino({ name: 'approval-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  const workflow = new InMemoryApprovalWorkflow(eventPublisher);

  await app.register(approvalRoutes(workflow), { prefix: '/api/v1/approvals' });
  app.get('/health', async () => ({ status: 'ok', service: 'approval-service' }));

  const port = parseInt(process.env['PORT'] ?? '3033', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`approval-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start approval-service');
  process.exit(1);
});

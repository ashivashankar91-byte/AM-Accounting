import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { t1Routes } from './http/routes';
import { AnthropicClaudeClient } from './infrastructure/claude-client';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { InMemoryAuditLogger } from './infrastructure/audit-logger';
import pino from 'pino';

const logger = pino({ name: 'agent-t1' });

async function bootstrap() {
  const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
  if (!ANTHROPIC_API_KEY) throw new Error('FATAL: ANTHROPIC_API_KEY environment variable is required. agent-t1 cannot start without it.');

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const claudeClient = new AnthropicClaudeClient(ANTHROPIC_API_KEY);
  const auditLogger = new InMemoryAuditLogger();
  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  await app.register(t1Routes(claudeClient, auditLogger, eventPublisher), { prefix: '/api/v1/agents' });
  app.get('/health', async () => ({ status: 'ok', service: 'agent-t1' }));

  const port = parseInt(process.env['PORT'] ?? '3024', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`agent-t1 listening on :${port}`);
}

bootstrap().catch((err) => { logger.error(err); process.exit(1); });

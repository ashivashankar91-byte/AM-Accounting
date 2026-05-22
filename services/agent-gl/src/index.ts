import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { GLIntegrityAgent } from './domain/gl-integrity-agent';
import { AnthropicClaudeClient } from './infrastructure/claude-client';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { IClaudeClient, IAuditLogger, IEventPublisher, asTenantId } from '@amacc/shared-kernel';
import { InMemoryAuditLogger } from './infrastructure/audit-logger';
import { GLAgentTools } from './infrastructure/agent-tools';
import pino from 'pino';

const logger = pino({ name: 'agent-gl' });

async function bootstrap() {
  const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
  if (!ANTHROPIC_API_KEY) throw new Error('FATAL: ANTHROPIC_API_KEY environment variable is required. agent-gl cannot start without it.');

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const claudeClient = new AnthropicClaudeClient(ANTHROPIC_API_KEY);
  const auditLogger = new InMemoryAuditLogger();
  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  container.registerInstance<IClaudeClient>('IClaudeClient', claudeClient);
  container.registerInstance<IAuditLogger>('IAuditLogger', auditLogger);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  const agent = new GLIntegrityAgent(claudeClient, auditLogger, eventPublisher);
  const tools = new GLAgentTools(asTenantId('default'));
  agent.setTools(tools);

  // Subscribe to events
  eventPublisher.subscribe('JOURNAL_ENTRY_SUBMITTED', async (event) => {
    logger.info({ event }, 'GL Integrity Agent triggered');
    tools.setTenantId(asTenantId(event.tenantId));
    await agent.execute(
      { tenantId: event.tenantId as any, schemaName: '', dmsType: 'AUTOMATE' as any },
      event,
    );
  });

  app.get('/health', async () => ({ status: 'ok', service: 'agent-gl' }));

  const port = parseInt(process.env['PORT'] ?? '3020', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`agent-gl listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start agent-gl');
  process.exit(1);
});

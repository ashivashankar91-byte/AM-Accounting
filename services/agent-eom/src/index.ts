import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { EOMOrchestrationAgent } from './domain/eom-agent';
import { AnthropicClaudeClient } from './infrastructure/claude-client';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { InMemoryAuditLogger } from './infrastructure/audit-logger';
import { EOMAgentTools } from './infrastructure/agent-tools';
import { asTenantId } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'agent-eom' });

async function bootstrap() {
  const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
  if (!ANTHROPIC_API_KEY) throw new Error('FATAL: ANTHROPIC_API_KEY environment variable is required. agent-eom cannot start without it.');

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const claudeClient = new AnthropicClaudeClient(ANTHROPIC_API_KEY);
  const auditLogger = new InMemoryAuditLogger();
  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  const agent = new EOMOrchestrationAgent(claudeClient, auditLogger, eventPublisher);
  const tools = new EOMAgentTools(asTenantId('default'));
  agent.setTools(tools);

  eventPublisher.subscribe('EOM_STEP_CHANGED', async (event) => {
    logger.info({ event }, 'EOM Orchestration Agent triggered');
    tools.setTenantId(asTenantId(event.tenantId));
    await agent.execute({ tenantId: event.tenantId as any, schemaName: '', dmsType: 'AUTOMATE' as any }, event);
  });

  app.get('/health', async () => ({ status: 'ok', service: 'agent-eom' }));
  const port = parseInt(process.env['PORT'] ?? '3021', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`agent-eom listening on :${port}`);
}

bootstrap().catch((err) => { logger.error(err); process.exit(1); });

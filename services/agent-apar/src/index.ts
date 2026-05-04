import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { APARReconAgent } from './domain/apar-agent';
import { AnthropicClaudeClient } from './infrastructure/claude-client';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { InMemoryAuditLogger } from './infrastructure/audit-logger';
import { APARAgentTools } from './infrastructure/agent-tools';
import { asTenantId } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'agent-apar' });

async function bootstrap() {
  const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
  if (!ANTHROPIC_API_KEY) throw new Error('FATAL: ANTHROPIC_API_KEY environment variable is required. agent-apar cannot start without it.');

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const claudeClient = new AnthropicClaudeClient(ANTHROPIC_API_KEY);
  const auditLogger = new InMemoryAuditLogger();
  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  const agent = new APARReconAgent(claudeClient, auditLogger, eventPublisher);
  const tools = new APARAgentTools(asTenantId('default'));
  agent.setTools(tools);

  eventPublisher.subscribe('OEM_REMITTANCE_IMPORTED', async (event) => {
    logger.info({ event }, 'APAR Recon Agent triggered by OEM remittance');
    tools.setTenantId(asTenantId(event.tenantId));
    await agent.execute({ tenantId: event.tenantId as any, schemaName: '', dmsType: 'AUTOMATE' as any }, event);
  });

  eventPublisher.subscribe('BANK_RECON_STARTED', async (event) => {
    logger.info({ event }, 'APAR Recon Agent triggered by bank recon');
    tools.setTenantId(asTenantId(event.tenantId));
    await agent.execute({ tenantId: event.tenantId as any, schemaName: '', dmsType: 'AUTOMATE' as any }, event);
  });

  app.get('/health', async () => ({ status: 'ok', service: 'agent-apar' }));
  const port = parseInt(process.env['PORT'] ?? '3023', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`agent-apar listening on :${port}`);
}

bootstrap().catch((err) => { logger.error(err); process.exit(1); });

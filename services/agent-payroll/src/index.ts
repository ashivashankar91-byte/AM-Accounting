import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PayrollIntegrityAgent } from './domain/payroll-agent';
import { AnthropicClaudeClient } from './infrastructure/claude-client';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { InMemoryAuditLogger } from './infrastructure/audit-logger';
import { PayrollAgentTools } from './infrastructure/agent-tools';
import { asTenantId } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'agent-payroll' });

async function bootstrap() {
  const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];
  if (!ANTHROPIC_API_KEY) throw new Error('FATAL: ANTHROPIC_API_KEY environment variable is required. agent-payroll cannot start without it.');

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const claudeClient = new AnthropicClaudeClient(ANTHROPIC_API_KEY);
  const auditLogger = new InMemoryAuditLogger();
  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  const agent = new PayrollIntegrityAgent(claudeClient, auditLogger, eventPublisher);
  const tools = new PayrollAgentTools(asTenantId('default'));
  agent.setTools(tools);

  eventPublisher.subscribe('PAYROLL_BATCH_SUBMITTED', async (event) => {
    logger.info({ event }, 'Payroll Integrity Agent triggered');
    tools.setTenantId(asTenantId(event.tenantId));
    await agent.execute({ tenantId: event.tenantId as any, schemaName: '', dmsType: 'AUTOMATE' as any }, event);
  });

  app.get('/health', async () => ({ status: 'ok', service: 'agent-payroll' }));
  const port = parseInt(process.env['PORT'] ?? '3022', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`agent-payroll listening on :${port}`);
}

bootstrap().catch((err) => { logger.error(err); process.exit(1); });

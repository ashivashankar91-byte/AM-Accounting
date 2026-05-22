import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { T1CopilotAgent } from '../domain/t1-copilot-agent';
import { AnthropicClaudeClient } from '../infrastructure/claude-client';
import { InMemoryAuditLogger } from '../infrastructure/audit-logger';
import { RabbitMQEventPublisher } from '../infrastructure/event-publisher';
import { T1AgentTools } from '../infrastructure/agent-tools';
import { asTenantId, createEvent, DMSType } from '@amacc/shared-kernel';

const ChatSchema = z.object({
  message: z.string().min(1),
  tenantId: z.string().min(1),
  userName: z.string().optional(),
  userRole: z.string().optional(),
  dealerName: z.string().optional(),
  oems: z.array(z.string()).optional(),
});

export function t1Routes(
  claudeClient: AnthropicClaudeClient,
  auditLogger: InMemoryAuditLogger,
  eventPublisher: RabbitMQEventPublisher,
) {
  return async function (app: FastifyInstance) {
    // POST /api/v1/agents/t1/chat — SSE streaming chat
    app.post('/t1/chat', async (request, reply) => {
      let parsed: z.infer<typeof ChatSchema>;
      try {
        parsed = ChatSchema.parse(request.body);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
      const { message, tenantId, userName, userRole, dealerName, oems } = parsed;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const agent = new T1CopilotAgent(claudeClient, auditLogger, eventPublisher);
      const tools = new T1AgentTools(asTenantId(tenantId));

      const context = {
        tenantId: asTenantId(tenantId),
        schemaName: '',
        dmsType: DMSType.AUTOMATE,
        userName: userName ?? 'Unknown',
        userRole: (userRole ?? 'DEALER_ACCOUNTANT') as any,
        dealerName: dealerName ?? 'Unknown Dealer',
        oems: (oems ?? []) as any[],
      };

      try {
        const result = await claudeClient.streamWithTools(
          agent.getSystemPrompt(context),
          message,
          agent.buildTools(context),
          agent.buildToolExecutor(context),
          (chunk: string) => {
            reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: chunk })}\n\n`);
          },
        );

        reply.raw.write(`data: ${JSON.stringify({ type: 'done', result: result.outcome })}\n\n`);
      } catch (err: any) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      }

      reply.raw.end();
    });

    // GET /api/v1/agents/log — Agent log
    app.get('/log', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const logs = await auditLogger.getByTenant(asTenantId(tenantId));
      return reply.send(logs);
    });

    // GET /api/v1/agents/log/:id — Single log
    app.get('/log/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const log = await auditLogger.getById(id);
      if (!log) return reply.status(404).send({ error: 'Not found' });
      return reply.send(log);
    });

    // POST /api/v1/agents/log/:id/resolve — Resolve human-required
    app.post('/log/:id/resolve', async (request, reply) => {
      const { id } = request.params as { id: string };
      await auditLogger.resolveHumanRequired(id);
      return reply.send({ resolved: true });
    });
  };
}

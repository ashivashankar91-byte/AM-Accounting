import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { T1CopilotAgent } from '../domain/t1-copilot-agent';
import { AnthropicClaudeClient } from '../infrastructure/claude-client';
import { RabbitMQEventPublisher } from '../infrastructure/event-publisher';
import { T1AgentTools } from '../infrastructure/agent-tools';
import { asTenantId, createEvent, DMSType, IAuditLogger } from '@amacc/shared-kernel';

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
  auditLogger: IAuditLogger,
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

    // GET /api/v1/agents/log — Agent log. Optional ?agentName= narrows to
    // one agent (e.g. the dashboard's per-card drill-in); ?limit=/?offset=
    // paginate beyond the default most-recent-50 page.
    app.get('/log', async (request, reply) => {
      const tenantId = request.headers['x-tenant-id'] as string;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const query = request.query as { agentName?: string; limit?: string; offset?: string };
      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      const offset = query.offset ? parseInt(query.offset, 10) : 0;
      const logs = await auditLogger.getByTenant(asTenantId(tenantId), limit, query.agentName, offset);
      return reply.send(logs);
    });

    // GET /api/v1/agents/log/:id — Single log
    app.get('/log/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = request.headers['x-tenant-id'] as string;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const log = await auditLogger.getById(id, tenantId);
      if (!log) return reply.status(404).send({ error: 'Not found' });
      return reply.send(log);
    });

    // POST /api/v1/agents/log/:id/resolve — Resolve human-required
    app.post('/log/:id/resolve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const tenantId = request.headers['x-tenant-id'] as string;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      await auditLogger.resolveHumanRequired(id, tenantId);
      return reply.send({ resolved: true });
    });
  };
}

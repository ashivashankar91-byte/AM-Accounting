import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InMemoryApprovalWorkflow } from '../application/approval-workflow';
import { asTenantId, asUserId, authMiddleware } from '@amacc/shared-kernel';

function getTenantId(request: any) {
  const id = request.headers['x-tenant-id'] as string;
  if (!id || id.trim() === '') { const e: any = new Error('x-tenant-id header is required'); e.statusCode = 400; throw e; }
  return asTenantId(id);
}

const RequestApprovalSchema = z.object({
  agentName: z.string(),
  actionType: z.string(),
  entityRef: z.string(),
  reasoning: z.string(),
  evidence: z.array(z.string()),
  requiredRole: z.string().default('AGENT_APPROVER'),
  timeoutMinutes: z.number().int().positive().default(60),
});

const DecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().optional(),
});

export function approvalRoutes(workflow: InMemoryApprovalWorkflow) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // POST /approvals/request
    app.post('/request', async (request, reply) => {
      const tenantId = getTenantId(request);
      const body = RequestApprovalSchema.parse(request.body);
      const result = await workflow.requestApproval(
        {
          id: '', tenantId, agentName: body.agentName, actionType: body.actionType as any,
          entityRef: body.entityRef, reasoning: body.reasoning, evidence: body.evidence,
          proposedAt: new Date(), expiresAt: new Date(), status: 'PENDING',
        },
        body.requiredRole as any,
        tenantId,
        body.timeoutMinutes,
      );
      return reply.status(201).send(result);
    });

    // GET /approvals/pending/:tenantId
    app.get('/pending/:tenantId', async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const pending = await workflow.getPending(asTenantId(tenantId));
      return reply.send(pending);
    });

    // POST /approvals/:id/approve
    app.post('/:id/approve', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { note } = (request.body as any) ?? {};
      const userId = (request.headers['x-user-id'] as string) ?? 'unknown';
      await workflow.processDecision(id, asUserId(userId), 'APPROVE', note);
      return reply.send({ approved: true });
    });

    // POST /approvals/:id/reject
    app.post('/:id/reject', async (request, reply) => {
      const { id } = request.params as { id: string };
      const { note } = DecisionSchema.parse(request.body ?? { decision: 'REJECT' });
      const userId = (request.headers['x-user-id'] as string) ?? 'unknown';
      await workflow.processDecision(id, asUserId(userId), 'REJECT', note);
      return reply.send({ rejected: true });
    });

    // GET /approvals/history/:tenantId
    app.get('/history/:tenantId', async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const history = await workflow.getHistory(asTenantId(tenantId));
      return reply.send(history);
    });
  };
}

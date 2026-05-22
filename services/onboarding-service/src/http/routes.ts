import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InMemoryOnboardingService } from '../application/onboarding-service';
import { asTenantId, authMiddleware } from '@amacc/shared-kernel';
import { COA_TEMPLATES, validateAccountRanges } from '../domain/coa-templates';

const StartSchema = z.object({
  dealerName: z.string().min(1),
  slug: z.string().min(1),
  oems: z.array(z.string()).min(1),
});

const CompleteStepSchema = z.object({
  step: z.enum(['DMS_CONFIG', 'OEM_CONFIG', 'COA_SETUP', 'IMPORT_HISTORY', 'FS_VALIDATION']),
  data: z.record(z.unknown()).default({}),
});

export function onboardingRoutes(service: InMemoryOnboardingService) {
  return async function (app: FastifyInstance) {
    const JWT_SECRET = process.env['AMACC_JWT_SECRET'] ?? 'amacc-dev-secret-change-in-production';
    app.addHook('preHandler', authMiddleware(JWT_SECRET));

    // POST /onboarding/start
    app.post('/start', async (request, reply) => {
      const body = StartSchema.parse(request.body);
      const session = await service.startOnboarding(body.dealerName, body.slug, body.oems as any);
      return reply.status(201).send(session);
    });

    // POST /onboarding/:sessionId/step
    app.post('/:sessionId/step', async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const body = CompleteStepSchema.parse(request.body);
      const session = await service.completeStep(sessionId, body.step, body.data);
      return reply.send(session);
    });

    // POST /onboarding/:sessionId/fail
    app.post('/:sessionId/fail', async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const { reason } = (request.body as any) ?? {};
      const session = await service.failStep(sessionId, reason ?? 'Unknown error');
      return reply.send(session);
    });

    // GET /onboarding/:sessionId
    app.get('/:sessionId', async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const session = await service.getSession(sessionId);
      if (!session) return reply.status(404).send({ error: 'Not found' });
      return reply.send(session);
    });

    // GET /onboarding/tenant/:tenantId
    app.get('/tenant/:tenantId', async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const session = await service.getSessionByTenant(asTenantId(tenantId));
      if (!session) return reply.status(404).send({ error: 'Not found' });
      return reply.send(session);
    });

    // GET /onboarding
    app.get('/', async (_request, reply) => {
      const sessions = await service.listSessions();
      return reply.send(sessions);
    });

    // GET /onboarding/:sessionId/validation
    app.get('/:sessionId/validation', async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const session = await service.getSession(sessionId) as any;
      if (!session) return reply.status(404).send({ error: 'Not found' });
      const oem = (session.oems?.[0] ?? 'DEFAULT').toUpperCase();
      const template = COA_TEMPLATES[oem] ?? COA_TEMPLATES['DEFAULT'];
      const accounts = (session as any).COA_SETUP_data?.accounts ?? template.accounts;
      const result = validateAccountRanges(accounts);
      return reply.send({ sessionId, oem, template: template.accounts.length, ...result });
    });

    // POST /onboarding/:sessionId/complete
    app.post('/:sessionId/complete', async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const session = await service.getSession(sessionId);
      if (!session) return reply.status(404).send({ error: 'Not found' });
      if (session.status !== 'IN_PROGRESS') return reply.status(400).send({ error: 'Not in progress' });
      return reply.send({ sessionId, status: 'COMPLETED', message: 'Onboarding completed' });
    });

    // GET /onboarding/templates/:oem
    app.get('/templates/:oem', async (request, reply) => {
      const { oem } = request.params as { oem: string };
      const template = COA_TEMPLATES[oem.toUpperCase()] ?? COA_TEMPLATES['DEFAULT'];
      return reply.send(template);
    });

    // GET /onboarding/status — overall onboarding status across all sessions
    app.get('/status', async (_request, reply) => {
      const sessions = await service.listSessions();
      const total = sessions.length;
      const completed = sessions.filter((s: any) => s.status === 'COMPLETED').length;
      const inProgress = sessions.filter((s: any) => s.status === 'IN_PROGRESS').length;
      const failed = sessions.filter((s: any) => s.status === 'FAILED').length;
      return reply.send({
        total,
        completed,
        inProgress,
        failed,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        status: inProgress > 0 ? 'IN_PROGRESS' : completed === total && total > 0 ? 'ALL_COMPLETE' : 'IDLE',
        updatedAt: new Date().toISOString(),
      });
    });
  };
}

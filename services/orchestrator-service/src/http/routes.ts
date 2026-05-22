import { FastifyInstance } from 'fastify';
import { authMiddleware } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/orchestrator-client';
import pino from 'pino';

const logger = pino({ name: 'orchestrator-routes' });

// -- Workflow Definitions -------------------------------------------------
// @intelligence-layer Workflow Orchestration
// @why-built COBOL had no cross-program orchestration. purge.cbl called subroutines
//   sequentially with no retry, no rollback, no visibility. The orchestrator provides:
//   - Step-by-step execution with status tracking via OrchestrationTask Prisma model
//   - Real-time visibility into workflow progress across all tenants

const WORKFLOWS: Record<string, { name: string; steps: string[] }> = {
  EOM_CLOSE: {
    name: 'End-of-Month Close',
    steps: ['Freeze GL Period','Run Unposted Entries Check','Calculate Accruals','Post Adjusting Entries','Reconcile Sub-Ledgers','Generate Trial Balance','Run Variance Analysis','Generate Financial Reports','Archive Period Data','Open Next Period'],
  },
  PAYROLL_REVIEW: {
    name: 'Payroll Review Cycle',
    steps: ['Import Time Records','Validate Hours & Rates','Calculate Gross Pay','Apply Deductions & Benefits','Calculate Employer Taxes','Generate Pay Stubs','Post GL Entries','Generate ACH File'],
  },
  YEAR_END_CLOSE: {
    name: 'Year-End Close',
    steps: ['Complete Final Month Close','Post Depreciation Entries','Reconcile All Accounts','Post Closing Entries','Generate Annual Statements','Close Fiscal Year','Roll Forward Balances'],
  },
};

export function orchestratorRoutes(prisma: PrismaClient, jwtSecret: string) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', authMiddleware(jwtSecret));

    app.get('/api/v1/orchestrator/workflows', async (_req, reply) => {
      return reply.send(Object.entries(WORKFLOWS).map(([key, wf]) => ({
        type: key, name: wf.name, stepCount: wf.steps.length, steps: wf.steps,
      })));
    });

    app.post<{ Body: { workflowType: string; startedBy?: string } }>(
      '/api/v1/orchestrator/start',
      async (req, reply) => {
        const tenantId = req.headers['x-tenant-id'] as string | undefined;
        if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
        const { workflowType, startedBy } = req.body || {};

        const wf = WORKFLOWS[workflowType];
        if (!wf) return reply.status(400).send({ error: `Unknown workflow: ${workflowType}. Available: ${Object.keys(WORKFLOWS).join(', ')}` });

        const steps = wf.steps.map((name, i) => ({
          name, status: i === 0 ? 'RUNNING' : 'PENDING',
          startedAt: i === 0 ? new Date().toISOString() : undefined,
        }));

        const task = await prisma.orchestrationTask.create({
          data: { tenantId, workflowType, status: 'RUNNING', currentStep: 0, totalSteps: steps.length, steps, startedAt: new Date(), startedBy: startedBy ?? 'system' },
        });
        logger.info({ taskId: task.id, tenantId, workflowType }, 'Orchestration task started');
        return reply.status(201).send(task);
      },
    );

    app.get<{ Params: { id: string } }>('/api/v1/orchestrator/tasks/:id', async (req, reply) => {
      const task = await prisma.orchestrationTask.findUnique({ where: { id: req.params.id } });
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      return reply.send(task);
    });

    app.post<{ Params: { id: string } }>('/api/v1/orchestrator/tasks/:id/advance', async (req, reply) => {
      const task = await prisma.orchestrationTask.findUnique({ where: { id: req.params.id } });
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      if (task.status !== 'RUNNING') return reply.status(400).send({ error: `Task is ${task.status}` });

      const steps = task.steps as any[];
      steps[task.currentStep].status = 'COMPLETED';
      steps[task.currentStep].completedAt = new Date().toISOString();
      const nextStep = task.currentStep + 1;
      const isComplete = nextStep >= task.totalSteps;
      if (!isComplete) { steps[nextStep].status = 'RUNNING'; steps[nextStep].startedAt = new Date().toISOString(); }

      const updated = await prisma.orchestrationTask.update({
        where: { id: task.id },
        data: { steps, currentStep: isComplete ? task.currentStep : nextStep, status: isComplete ? 'COMPLETED' : 'RUNNING', completedAt: isComplete ? new Date() : null },
      });
      return reply.send(updated);
    });

    app.post<{ Params: { id: string } }>('/api/v1/orchestrator/tasks/:id/pause', async (req, reply) => {
      const task = await prisma.orchestrationTask.findUnique({ where: { id: req.params.id } });
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      if (task.status !== 'RUNNING') return reply.status(400).send({ error: `Cannot pause: status is ${task.status}` });
      const steps = task.steps as any[];
      steps[task.currentStep].status = 'PAUSED';
      return reply.send(await prisma.orchestrationTask.update({ where: { id: task.id }, data: { status: 'PAUSED', steps } }));
    });

    app.post<{ Params: { id: string } }>('/api/v1/orchestrator/tasks/:id/resume', async (req, reply) => {
      const task = await prisma.orchestrationTask.findUnique({ where: { id: req.params.id } });
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      if (task.status !== 'PAUSED') return reply.status(400).send({ error: `Cannot resume: status is ${task.status}` });
      const steps = task.steps as any[];
      steps[task.currentStep].status = 'RUNNING';
      steps[task.currentStep].startedAt = new Date().toISOString();
      return reply.send(await prisma.orchestrationTask.update({ where: { id: task.id }, data: { status: 'RUNNING', steps } }));
    });

    app.get('/api/v1/orchestrator/status', async (req, reply) => {
      const tenantId = req.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const running = await prisma.orchestrationTask.findMany({ where: { tenantId, status: 'RUNNING' } }).catch(() => []);
      return reply.send({ status: 'operational', activeTasks: running.length, workflows: Object.keys(WORKFLOWS) });
    });

    app.get('/api/v1/orchestrator/tasks', async (req, reply) => {
      const tenantId = req.headers['x-tenant-id'] as string | undefined;
      if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
      const tasks = await prisma.orchestrationTask.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
      return reply.send(tasks);
    });
  };
}

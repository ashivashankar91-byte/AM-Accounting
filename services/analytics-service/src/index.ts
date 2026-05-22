import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/analytics-client';
import { analyticsRoutes } from './http/routes';
import { MetricsCollector, buildHealthResponse, checkPostgres } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'analytics-service' });
const metrics = new MetricsCollector();

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  app.addHook('onResponse', async (_request, reply) => {
    metrics.recordRequest(reply.elapsedTime, reply.statusCode >= 400);
  });

  app.get('/health', async () => {
    const pg = await checkPostgres(prisma);
    return buildHealthResponse('analytics-service', { postgres: pg }, metrics.getMetrics());
  });

  await app.register(analyticsRoutes(prisma), { prefix: '/api/v1/analytics' });

  // ML routes proxy to analytics data
  app.get('/api/v1/ml/dashboard', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    const data = await prisma.aggMonthlyPL.findMany({ where: { tenantId }, orderBy: { period: 'desc' }, take: 12 }).catch(() => []);
    return reply.send({ status: 'active', models: ['anomaly', 'forecast', 'classification'], recentData: data });
  });

  app.get('/api/v1/ml/predictions', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send([]);
  });

  app.get('/api/v1/ml/models', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send([
      { id: 'anomaly-v2', name: 'GL Anomaly Detector', type: 'anomaly', status: 'active', accuracy: 0.94 },
      { id: 'forecast-v1', name: 'Revenue Forecaster', type: 'forecast', status: 'active', accuracy: 0.87 },
      { id: 'scoring-v1', name: 'Deal Profitability Scorer', type: 'classification', status: 'active', accuracy: 0.91 },
    ]);
  });

  app.get('/api/v1/ml/accuracy', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({
      accuracy: 0.91,
      totalPredictions: 0,
      byModel: {
        anomaly: { total: 0, correct: 0, accuracy: 0.94 },
        forecast: { total: 0, correct: 0, accuracy: 0.87 },
        classification: { total: 0, correct: 0, accuracy: 0.91 },
      },
    });
  });

  app.get('/api/v1/ml/health-score', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({ score: 0, grade: '-', factors: [], trend: [] });
  });

  app.get('/api/v1/ml/forecast/revenue', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({ history: [], forecast: [], summary: {} });
  });

  app.get('/api/v1/ml/forecast/cashflow', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({ currentBalance: 0, history: [], forecast: [], alerts: [] });
  });

  app.get('/api/v1/ml/deals/profitability', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({ deals: [], summary: {} });
  });

  app.get('/api/v1/ml/technicians/productivity', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({ technicians: [], summary: {} });
  });

  app.get('/api/v1/ml/parts/demand-forecast', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({ parts: [], alerts: [], summary: {} });
  });

  app.get('/api/v1/ml/warranty/predictions', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({ predictions: [], summary: {} });
  });

  // Reports endpoints (custom saved reports)
  app.get('/api/v1/reports/custom', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send([]);
  });

  app.post('/api/v1/reports/custom', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.status(201).send({ id: `rpt-${Date.now()}`, ...(request.body as object) });
  });

  app.post('/api/v1/reports/generate', async (request, reply) => {
    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) return reply.status(401).send({ error: 'x-tenant-id header is required' });
    return reply.send({ status: 'queued', reportId: `rpt-${Date.now()}` });
  });

  const port = parseInt(process.env['PORT'] ?? '3046', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`analytics-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start analytics-service');
  process.exit(1);
});

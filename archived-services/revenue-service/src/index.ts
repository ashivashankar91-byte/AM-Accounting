import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/revenue-client';
import { revenueRoutes } from './http/routes';
import { MetricsCollector, buildHealthResponse, checkPostgres } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'revenue-service' });
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
    return buildHealthResponse('revenue-service', { postgres: pg }, metrics.getMetrics());
  });

  await app.register(revenueRoutes(prisma), { prefix: '/api/v1/revenue' });

  const port = parseInt(process.env['PORT'] ?? '3044', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`revenue-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start revenue-service');
  process.exit(1);
});

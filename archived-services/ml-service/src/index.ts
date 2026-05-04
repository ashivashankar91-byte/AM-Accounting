import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/ml-client';
import { mlRoutes } from './http/routes';
import { MetricsCollector, buildHealthResponse, checkPostgres } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'ml-service' });
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
    return buildHealthResponse('ml-service', { postgres: pg }, metrics.getMetrics());
  });

  await app.register(mlRoutes(prisma), { prefix: '/api/v1/ml' });

  const port = parseInt(process.env['PORT'] ?? '3047', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`ml-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start ml-service');
  process.exit(1);
});

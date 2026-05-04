import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/esg-client';
import { esgRoutes } from './http/routes';
import { MetricsCollector, buildHealthResponse, checkPostgres } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'esg-service' });
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
    return buildHealthResponse('esg-service', { postgres: pg }, metrics.getMetrics());
  });

  await app.register(esgRoutes(prisma), { prefix: '/api/v1/esg' });

  const port = parseInt(process.env['PORT'] ?? '3042', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`esg-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start esg-service');
  process.exit(1);
});

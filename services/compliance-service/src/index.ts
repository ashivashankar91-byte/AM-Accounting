import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/compliance-client';
import { complianceRoutes } from './http/routes';
import { MetricsCollector, buildHealthResponse, checkPostgres } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'compliance-service' });
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
    return buildHealthResponse('compliance-service', { postgres: pg }, metrics.getMetrics());
  });

  await app.register(complianceRoutes(prisma), { prefix: '/api/v1/compliance' });

  const port = parseInt(process.env['PORT'] ?? '3043', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`compliance-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start compliance-service');
  process.exit(1);
});

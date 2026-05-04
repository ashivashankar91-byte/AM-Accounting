import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import { PrismaClient } from '.prisma/query-client';
import { queryRoutes } from './http/routes';
import { MetricsCollector, buildHealthResponse, checkPostgres } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'query-service' });
const metrics = new MetricsCollector();

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const pool = new Pool({
    connectionString: process.env['DATABASE_URL'] ?? 'postgresql://amacc:amacc_dev@localhost:5433/amacc',
  });

  app.addHook('onResponse', async (_request, reply) => {
    metrics.recordRequest(reply.elapsedTime, reply.statusCode >= 400);
  });

  app.get('/health', async () => {
    const pg = await checkPostgres(prisma);
    return buildHealthResponse('query-service', { postgres: pg }, metrics.getMetrics());
  });

  await app.register(queryRoutes(prisma, pool), { prefix: '/api/v1/query' });

  const port = parseInt(process.env['PORT'] ?? '3045', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`query-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start query-service');
  process.exit(1);
});

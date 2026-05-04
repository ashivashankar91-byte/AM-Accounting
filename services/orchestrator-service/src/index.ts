import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/orchestrator-client';
import { orchestratorRoutes } from './http/routes.js';
import pino from 'pino';

const logger = pino({ name: 'orchestrator-service' });
const PORT = Number(process.env.PORT) || 3048;

async function main() {
  const JWT_SECRET = process.env['AMACC_JWT_SECRET'];
  if (!JWT_SECRET) throw new Error('FATAL: AMACC_JWT_SECRET environment variable is required. orchestrator-service cannot start without it.');

  const prisma = new PrismaClient();
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'orchestrator-service',
    timestamp: new Date().toISOString(),
  }));

  await app.register(orchestratorRoutes(prisma, JWT_SECRET));
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logger.info(`orchestrator-service listening on :${PORT}`);
}

main().catch((err) => { logger.error(err, 'Failed to start orchestrator-service'); process.exit(1); });

import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/fs-client';
import { fsRoutes } from './http/routes';
import { FSService } from './application/fs-service';
import { OEMProfileRepository } from './infrastructure/oem-profile-repository';
import { MappingRepository } from './infrastructure/mapping-repository';
import { StatementRepository } from './infrastructure/statement-repository';
import { SupplementalRepository } from './infrastructure/supplemental-repository';
import pino from 'pino';

const logger = pino({ name: 'fs-service' });

async function bootstrap() {
  if (!process.env['AMACC_JWT_SECRET']) {
    throw new Error('AMACC_JWT_SECRET env var is required');
  }

  const prisma = new PrismaClient();
  await prisma.$connect();

  const profileRepo = new OEMProfileRepository(prisma);
  const mappingRepo = new MappingRepository(prisma);
  const statementRepo = new StatementRepository(prisma);
  const supplementalRepo = new SupplementalRepository(prisma);

  const fsService = new FSService(profileRepo, mappingRepo, statementRepo, supplementalRepo);

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  await app.register(fsRoutes(fsService), { prefix: '/api/v1/fs' });
  app.get('/health', async () => ({ status: 'ok', service: 'fs-service' }));

  const port = parseInt(process.env['PORT'] ?? '3015', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`fs-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start fs-service');
  process.exit(1);
});

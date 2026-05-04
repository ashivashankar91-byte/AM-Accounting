import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '.prisma/document-client';
import { DocumentService } from './application/document-service';
import { documentRoutes } from './http/routes';
import pino from 'pino';

const logger = pino({ name: 'document-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const documentService = new DocumentService(prisma);

  await app.register(documentRoutes(documentService), { prefix: '/api/v1/documents' });
  app.get('/health', async () => ({ status: 'ok', service: 'document-service' }));

  const port = parseInt(process.env['PORT'] ?? '3038', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`document-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start document-service');
  process.exit(1);
});

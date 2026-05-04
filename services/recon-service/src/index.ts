import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/recon-client';
import { reconRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaBankReconRepository } from './infrastructure/recon-repository';
import { PrismaBankTransactionRepository } from './infrastructure/transaction-repository';
import { ReconService } from './application/recon-service';
import { IEventPublisher, IBankReconRepository, IBankTransactionRepository } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'recon-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  const prisma = new PrismaClient();
  await prisma.$connect();
  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.register<IBankReconRepository>('IBankReconRepository', { useClass: PrismaBankReconRepository });
  container.register<IBankTransactionRepository>('IBankTransactionRepository', { useClass: PrismaBankTransactionRepository });
  container.register('ReconService', { useClass: ReconService });

  await app.register(reconRoutes, { prefix: '/api/v1/recon' });
  app.get('/health', async () => ({ status: 'ok', service: 'recon-service' }));

  const port = parseInt(process.env['PORT'] ?? '3014', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`recon-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start recon-service');
  process.exit(1);
});

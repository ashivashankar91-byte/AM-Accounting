import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { tenantRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PrismaTenantRepository } from './infrastructure/tenant-repository';
import { TenantService } from './application/tenant-service';
import { IEventPublisher, ITenantRepository } from '@amacc/shared-kernel';
import { PrismaClient } from '.prisma/tenant-client';
import pino from 'pino';

const logger = pino({ name: 'tenant-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();

  // DI registrations
  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.register<ITenantRepository>('ITenantRepository', {
    useClass: PrismaTenantRepository,
  } as any);
  container.register('TenantService', { useClass: TenantService });

  await app.register(tenantRoutes, { prefix: '/api/v1/tenants' });
  app.get('/health', async () => ({ status: 'ok', service: 'tenant-service' }));

  const port = parseInt(process.env['PORT'] ?? '3002', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`tenant-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start tenant-service');
  process.exit(1);
});

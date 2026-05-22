import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { authRoutes } from './http/routes';
import { developerRoutes } from './http/developer-routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { IEventPublisher } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'auth-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // DI registrations
  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);

  // Register routes
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  if (process.env['NODE_ENV'] === 'development') {
    await app.register(developerRoutes);
  }

  // Health check
  app.get('/health', async () => ({ status: 'ok', service: 'auth-service' }));
  app.get('/api/v1/auth/health', async () => ({ status: 'ok', service: 'auth-service' }));

  const port = parseInt(process.env['PORT'] ?? '3001', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`auth-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start auth-service');
  process.exit(1);
});

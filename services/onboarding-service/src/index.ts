import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { onboardingRoutes } from './http/routes';
import { InMemoryOnboardingService } from './application/onboarding-service';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import pino from 'pino';

const logger = pino({ name: 'onboarding-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const eventPublisher = new RabbitMQEventPublisher({ url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672' });
  await eventPublisher.connect();

  const service = new InMemoryOnboardingService(eventPublisher);

  await app.register(onboardingRoutes(service), { prefix: '/api/v1/onboarding' });
  app.get('/health', async () => ({ status: 'ok', service: 'onboarding-service' }));

  const port = parseInt(process.env['PORT'] ?? '3035', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`onboarding-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start onboarding-service');
  process.exit(1);
});

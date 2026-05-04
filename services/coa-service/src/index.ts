import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { coaRoutes } from './http/routes';
import { CoAService } from './application/coa-service';
import pino from 'pino';

const logger = pino({ name: 'coa-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const coaService = new CoAService();

  await app.register(coaRoutes(coaService), { prefix: '/api/v1/coa' });
  app.get('/health', async () => ({ status: 'ok', service: 'coa-service' }));

  const port = parseInt(process.env['PORT'] ?? '3016', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`coa-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start coa-service');
  process.exit(1);
});

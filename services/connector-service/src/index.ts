import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { connectorRoutes } from './http/routes';
import { ingestRoutes } from './http/ingest-routes';
import { DMSAdapterRegistry } from './domain/adapter-registry';
import { AutoMateAdapter, CDKAdapter, ReynoldsAdapter, DealertrackAdapter } from './domain/adapters';
import pino from 'pino';

const logger = pino({ name: 'connector-service' });

async function bootstrap() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  // Open/Closed: register adapters — adding a new DMS = new adapter class + register here
  const registry = new DMSAdapterRegistry();
  registry.register('automate', new AutoMateAdapter());
  registry.register('cdk', new CDKAdapter());
  registry.register('reynolds', new ReynoldsAdapter());
  registry.register('dealertrack', new DealertrackAdapter());

  await app.register(connectorRoutes(registry), { prefix: '/api/v1/connector' });
  await app.register(ingestRoutes, { prefix: '/api/v1/connector/ingest' });
  app.get('/health', async () => ({ status: 'ok', service: 'connector-service' }));

  const port = parseInt(process.env['PORT'] ?? '3032', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`connector-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start connector-service');
  process.exit(1);
});

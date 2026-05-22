import 'reflect-metadata';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { container } from 'tsyringe';
import { PrismaClient } from '.prisma/payroll-client';
import { payrollRoutes } from './http/routes';
import { RabbitMQEventPublisher } from './infrastructure/event-publisher';
import { PayrollService } from './application/payroll-service';
import { IEventPublisher, OutboxProcessor } from '@amacc/shared-kernel';
import { PrismaEmployeeRepository } from './infrastructure/employee-repository';
import { PrismaBatchRepository } from './infrastructure/batch-repository';
import { PrismaPayrollItemRepository } from './infrastructure/payroll-item-repository';
import { PrismaGLMappingRepository } from './infrastructure/gl-mapping-repository';
import { PrismaTaxRateRepository } from './infrastructure/tax-rate-repository';
import { PrismaEmployeeYTDRepository } from './infrastructure/employee-ytd-repository';
import pino from 'pino';

const logger = pino({ name: 'payroll-service' });

async function bootstrap() {
  if (!process.env['AMACC_JWT_SECRET']) {
    throw new Error('AMACC_JWT_SECRET env var is required');
  }

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const prisma = new PrismaClient();
  await prisma.$connect();

  const eventPublisher = new RabbitMQEventPublisher({
    url: process.env['RABBITMQ_URL'] ?? 'amqp://localhost:5672',
  });
  await eventPublisher.connect();

  container.registerInstance('PrismaClient', prisma);
  container.registerInstance<IEventPublisher>('IEventPublisher', eventPublisher);
  container.register('IEmployeeRepository', { useClass: PrismaEmployeeRepository });
  container.register('IBatchRepository', { useClass: PrismaBatchRepository });
  container.register('IPayrollItemRepository', { useClass: PrismaPayrollItemRepository });
  container.register('IGLMappingRepository', { useClass: PrismaGLMappingRepository });
  container.register('ITaxRateRepository', { useClass: PrismaTaxRateRepository });
  container.register('IEmployeeYTDRepository', { useClass: PrismaEmployeeYTDRepository });
  container.register('PayrollService', { useClass: PayrollService });

  // Start outbox processor
  const outboxProcessor = new OutboxProcessor(
    eventPublisher,
    async () => {
      const records = await prisma.outboxEvent.findMany({
        where: { publishedAt: null, retryCount: { lt: 10 } },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      return records.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        tenantId: r.tenantId,
        payload: r.payload as Record<string, unknown>,
        correlationId: r.correlationId,
        publishedAt: r.publishedAt,
        retryCount: r.retryCount,
        lastError: r.lastError,
      }));
    },
    async (id: string) => {
      await prisma.outboxEvent.update({ where: { id }, data: { publishedAt: new Date() } });
    },
    async (id: string, error?: string) => {
      await prisma.outboxEvent.update({
        where: { id },
        data: { retryCount: { increment: 1 }, lastError: error ?? null },
      });
    },
  );
  outboxProcessor.startPolling(5000);

  app.addHook('onClose', async () => {
    (outboxProcessor as any).stopPolling?.();
    await prisma.$disconnect();
  });

  await app.register(payrollRoutes, { prefix: '/api/v1/payroll' });
  app.get('/health', async () => ({ status: 'ok', service: 'payroll-service' }));

  const port = parseInt(process.env['PORT'] ?? '3012', 10);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`payroll-service listening on :${port}`);
}

bootstrap().catch((err) => {
  logger.error(err, 'Failed to start payroll-service');
  process.exit(1);
});
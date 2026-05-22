import { Prisma } from '.prisma/gl-client';
import pino from 'pino';

const logger = pino({ name: 'serializable-retry' });

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 100;

export async function withSerializableRetry<T>(
  prisma: any,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (err: any) {
      // P2034 is Prisma's wrapper for PostgreSQL 40001 (serialization failure)
      const isSerializationFailure =
        err.code === 'P2034' ||
        err.message?.includes('could not serialize access') ||
        err.meta?.code === '40001';

      if (isSerializationFailure && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 100, 200, 400, 800, 1600ms
        logger.warn({ attempt, delay, error: err.message }, 'Serialization failure; retrying');
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Serialization retry exhausted after 5 attempts');
}

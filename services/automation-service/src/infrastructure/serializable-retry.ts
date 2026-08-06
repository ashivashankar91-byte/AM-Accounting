import { Prisma } from '.prisma/automation-service-client';
import { RlsTenantContext, setTenantContextOnConnection } from '@amacc/shared-kernel';
import pino from 'pino';

const logger = pino({ name: 'automation-serializable-retry' });

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 100;

/**
 * SERIALIZABLE transaction with bounded retry.
 *
 * Claiming an automation item is a read-then-write race between every worker
 * in the fleet; SERIALIZABLE plus a version guard is what makes "exactly one
 * claimant" a database fact instead of a hopeful comment.
 */
export async function withSerializableRetry<T>(
  prisma: any,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await setTenantContextOnConnection(tx as any, RlsTenantContext.get());
        return fn(tx);
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (err: any) {
      const isSerializationFailure =
        err.code === 'P2034' ||
        err.message?.includes('could not serialize access') ||
        err.meta?.code === '40001';

      if (isSerializationFailure && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        logger.warn({ attempt, delay, error: err.message }, 'Serialization failure; retrying');
        await new Promise((resolve) => { setTimeout(resolve, delay); });
        continue;
      }
      throw err;
    }
  }
  throw new Error('Serialization retry exhausted after 5 attempts');
}

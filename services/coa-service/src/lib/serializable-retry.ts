import type { Prisma } from '.prisma/coa-client';
import pino from 'pino';

// S013 — SERIALIZABLE transaction helper with bounded exponential-backoff retry.
// Adopted from the gl-service pattern (Reuse After Refactoring). Used by the
// posting path so concurrent postings that touch the same account rows serialize
// correctly and transient 40001 serialization failures are retried, not surfaced.

const logger = pino({ name: 'coa-serializable-retry' });

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 50;

export async function withSerializableRetry<T>(
  prisma: any,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        // 'Serializable' === Prisma.TransactionIsolationLevel.Serializable; using
        // the string keeps this import type-only (no runtime prisma module load).
        isolationLevel: 'Serializable',
      });
    } catch (err: any) {
      const isSerializationFailure =
        err?.code === 'P2034' ||
        err?.message?.includes('could not serialize access') ||
        err?.meta?.code === '40001';
      if (isSerializationFailure && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn({ attempt, delay, error: err?.message }, 'serialization failure; retrying');
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('serialization retry exhausted after 5 attempts');
}
